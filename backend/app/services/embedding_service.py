from concurrent.futures import ThreadPoolExecutor
from threading import RLock
from pathlib import Path
import hashlib
import importlib.util
import numpy as np
from sqlalchemy import select
from ..models import Session, Photo, CaptureGroup, Embedding
from ..config import MODELS, DATA, settings
from .thumbnail_service import open_image

def similarity_scores(images: np.ndarray, texts: np.ndarray, mode: str) -> np.ndarray:
    images = images / np.maximum(np.linalg.norm(images, axis=1, keepdims=True), 1e-8)
    texts = texts / np.maximum(np.linalg.norm(texts, axis=1, keepdims=True), 1e-8)
    scores = images @ texts.T
    return scores.min(axis=1) if mode == 'all' else scores.max(axis=1)

class EmbeddingService:
    def __init__(self) -> None:
        self.lock = RLock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='local-ai')
        self.model = None
        self.processor = None
        self.model_name = settings()['ai_model']
        self.state = dict(status='not_loaded', stage='未加载本地模型', error=None, processed=0, total=0, indexed=0, failed=0)
        self.device = 'cpu'
        self._faiss = None
        self._index = None
        self._index_ids: list[str] = []
        self._index_model = ''

    def faiss_module(self):
        if self._faiss is None:
            try:
                import faiss
                self._faiss = faiss
            except ImportError:
                self._faiss = False
        return self._faiss or None

    def status(self) -> dict:
        with self.lock:
            result = self.state.copy()
        result.update(model=self.model_name, device=self.device, available=bool(importlib.util.find_spec('torch') and importlib.util.find_spec('transformers')),
                      cache=str(MODELS), cached_bytes=sum(p.stat().st_size for p in MODELS.rglob('*') if p.is_file()))
        return result

    def update(self, **values) -> None:
        with self.lock:
            self.state.update(values)

    def start(self, allow_download: bool = True) -> dict:
        with self.lock:
            if self.state['status'] in ('loading', 'indexing'):
                return self.state.copy()
            self.state.update(status='loading', stage='准备模型文件', error=None)
        self.pool.submit(self._prepare, allow_download)
        return self.status()

    def _prepare(self, allow_download: bool) -> None:
        try:
            import torch
            from transformers import ChineseCLIPModel, ChineseCLIPProcessor
            from huggingface_hub import snapshot_download
            self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
            self.update(stage='检查本地缓存 / 下载模型（仅下载模型，不上传照片）')
            location = snapshot_download(self.model_name, cache_dir=str(MODELS), local_files_only=not allow_download,
                allow_patterns=['config.json', 'preprocessor_config.json', 'tokenizer_config.json', 'special_tokens_map.json',
                                'vocab.txt', 'tokenizer.json', 'model.safetensors', 'pytorch_model.bin'])
            self.update(stage='加载 Chinese-CLIP')
            self.processor = ChineseCLIPProcessor.from_pretrained(location, local_files_only=True, use_fast=False)
            self.model = ChineseCLIPModel.from_pretrained(location, local_files_only=True).to(self.device).eval()
            self.index()
        except Exception as error:
            self.update(status='error', stage='AI 暂不可用；照片管理和水印仍可使用', error=str(error))

    def index_if_ready(self) -> None:
        if self.model is not None and self.state['status'] in ('ready', 'indexing'):
            self.pool.submit(self.index)

    def index(self) -> None:
        import torch
        if self.model is None:
            return
        with Session() as session:
            photos = session.scalars(select(Photo).join(CaptureGroup, CaptureGroup.preferred_photo_id == Photo.id)).all()
            done = {e.photo_id for e in session.scalars(select(Embedding).where(Embedding.model == self.model_name)) if Path(e.embedding_path).exists()}
        todo = [p for p in photos if p.id not in done and p.preview_path]
        indexed, failed = len(done), 0
        self.update(status='indexing', stage='在本机分析照片', total=len(todo), processed=0, indexed=indexed, failed=0)
        for i, photo in enumerate(todo):
            try:
                image = open_image(Path(photo.preview_path))
                with self.lock, torch.inference_mode():
                    inputs = self.processor(images=image, return_tensors='pt').to(self.device)
                    features = self.model.get_image_features(**inputs)
                    vector = features[0].float().cpu().numpy()
                vector /= max(float(np.linalg.norm(vector)), 1e-8)
                version = hashlib.sha256(self.model_name.encode()).hexdigest()[:12]
                target = DATA / 'embeddings' / f'{photo.id}-{version}.npy'
                np.save(target, vector, allow_pickle=False)
                with Session() as session:
                    if session.get(Photo, photo.id):
                        session.merge(Embedding(photo_id=photo.id, model=self.model_name, embedding_path=str(target)))
                        session.commit()
                indexed += 1
            except Exception as error:
                failed += 1
                self.update(error=str(error))
            self.update(processed=i+1, indexed=indexed, failed=failed)
        self._index = None
        self.update(status='ready', stage='本地语义索引已就绪')

    def search(self, keywords: list[str], mode: str, threshold: float, maximum: int) -> list[dict]:
        if self.model is None or self.state['status'] not in ('ready', 'indexing'):
            raise ValueError('请在设置中加载本地 AI 模型并建立索引；不会使用文件名冒充语义搜索')
        import torch
        with self.lock, torch.inference_mode():
            inputs = self.processor(text=keywords, padding=True, truncation=True, max_length=52, return_tensors='pt').to(self.device)
            # Chinese-CLIP projects the final CLS state directly. Transformers 4.57's
            # get_text_features incorrectly reads a disabled BERT pooler (None).
            text_output = self.model.text_model(**inputs, return_dict=True)
            features = self.model.text_projection(text_output.last_hidden_state[:, 0, :]).float().cpu().numpy()
        with Session() as session:
            entries = session.scalars(select(Embedding).join(CaptureGroup, CaptureGroup.preferred_photo_id == Embedding.photo_id).where(Embedding.model == self.model_name)).all()
        faiss = self.faiss_module()
        if faiss is not None:
            return self._search_faiss(faiss, entries, features, mode, threshold, maximum)
        ranked = []
        # Bound memory for large libraries; never re-encode images during search.
        for offset in range(0, len(entries), 512):
            valid, vectors = [], []
            for item in entries[offset:offset+512]:
                try:
                    vectors.append(np.load(item.embedding_path, allow_pickle=False))
                    valid.append(item)
                except (OSError, ValueError):
                    pass
            if vectors:
                scores = similarity_scores(np.stack(vectors), features, mode)
                ranked.extend(dict(photo_id=item.photo_id, similarity_score=float(score)) for item, score in zip(valid, scores) if score >= threshold)
        return sorted(ranked, key=lambda item: -item['similarity_score'])[:maximum]

    def _search_faiss(self, faiss, entries, features: np.ndarray, mode: str, threshold: float, maximum: int) -> list[dict]:
        if self._index is None or self._index_model != self.model_name or len(self._index_ids) != len(entries):
            ids, vectors = [], []
            for item in entries:
                try:
                    vectors.append(np.load(item.embedding_path, allow_pickle=False))
                    ids.append(item.photo_id)
                except (OSError, ValueError):
                    pass
            if not vectors:
                return []
            matrix = np.stack(vectors).astype('float32')
            self._index = faiss.IndexFlatIP(matrix.shape[1])
            self._index.add(matrix)
            self._index_ids, self._index_model = ids, self.model_name
        queries = features / np.maximum(np.linalg.norm(features, axis=1, keepdims=True), 1e-8)
        k = min(len(self._index_ids), max(maximum * 10, 500))
        scores, positions = self._index.search(queries.astype('float32'), k)
        per_photo: dict[str, list[float]] = {}
        for row in range(len(queries)):
            for score, position in zip(scores[row], positions[row]):
                if position < 0 or score < threshold:
                    continue
                per_photo.setdefault(self._index_ids[position], []).append(float(score))
        needed = len(queries) if mode == 'all' else 1
        ranked = [dict(photo_id=photo_id, similarity_score=min(values) if mode == 'all' else max(values))
                  for photo_id, values in per_photo.items() if len(values) >= needed]
        return sorted(ranked, key=lambda item: -item['similarity_score'])[:maximum]

service = EmbeddingService()
