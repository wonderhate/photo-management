from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from threading import RLock
from pathlib import Path
import importlib.util
import os
import tempfile
import numpy as np
from sqlalchemy import select
from ..models import Session, Photo, CaptureGroup, Embedding
from ..config import MODELS, DATA, settings
from .thumbnail_service import open_image
from . import jobs
from .embedding_space import model_manifest, source_signature, file_hash

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
        self.model_revision = ''
        self.model_manifest = {}
        self.state = dict(status='not_loaded', stage='未加载本地模型', error=None, processed=0, total=0, indexed=0, failed=0)
        self.device = 'cpu'
        self._faiss = None
        self._index = None
        self._index_ids: list[str] = []
        self._index_model = ''
        self._index_fingerprint = None
        self._index_queued = False
        self._index_again = False
        self.task_id = None
        # Normalized vectors only; bound the cache to about 16 MiB at 1024 dims.
        self._vectors = OrderedDict()

    def faiss_module(self):
        if self._faiss is None:
            try:
                import faiss
                self._faiss = faiss
            except ImportError:
                self._faiss = False
        return self._faiss or None

    def status(self) -> dict:
        self.refresh_task_state()
        with self.lock:
            result = self.state.copy()
            result['job_id'] = self.task_id
        result.update(model=self.model_name, model_revision=self.model_revision, device=self.device, available=bool(importlib.util.find_spec('torch') and importlib.util.find_spec('transformers')),
                      cache=str(MODELS), cached_bytes=sum(p.stat().st_size for p in MODELS.rglob('*') if p.is_file()))
        return result

    def update(self, **values) -> None:
        with self.lock:
            self.state.update(values)

    def start(self, allow_download: bool = True) -> dict:
        self.refresh_task_state()
        with self.lock:
            if self.state['status'] in ('loading', 'indexing'):
                return self.state.copy() | {'job_id':self.task_id}
            self.state.update(status='loading', stage='准备模型文件', error=None)
            self._index_queued = True
            try:
                job = jobs.submit('semantic-prepare', self._prepare, allow_download, executor=self.pool, resource='local-ai')
                self.task_id = job['id']
            except Exception:
                self._index_queued = False
                self.state.update(status='ready' if self.model is not None else 'not_loaded',stage='未能创建本地语义任务')
                raise
        return self.status()

    def refresh_task_state(self) -> None:
        # A waiting task can be cancelled before its callback ever starts.
        # Reconcile lazily without loading a model or automatically rescheduling.
        with self.lock:
            task_id = self.task_id
        task = jobs.get(task_id) if task_id else None
        if not task or task['status'] in jobs.ACTIVE:
            return
        with self.lock:
            if self.task_id != task_id or self.state['status'] not in ('loading','indexing'):
                return
            self._index_queued = self._index_again = False
            if task['status'] in ('cancelled','interrupted'):
                self.state.update(status='ready' if self.model is not None else 'not_loaded',
                                  stage='本地语义任务已取消，已完成索引保留',error=None)
            elif task['status']=='failed':
                self.state.update(status='error',stage='AI 暂不可用；照片管理和水印仍可使用',error=task.get('error'))

    def _task_error(self, error: Exception, job_id: str) -> None:
        with self.lock:
            if self.task_id!=job_id:
                return
            self._index_queued = self._index_again = False
            if isinstance(error,jobs.JobCancelled):
                self.state.update(status='ready' if self.model is not None else 'not_loaded',
                                  stage='本地语义任务已取消，已完成索引保留',error=None)
            else:
                self.state.update(status='error',stage='AI 暂不可用；照片管理和水印仍可使用',error=str(error))

    def _prepare(self, job_id: str, allow_download: bool) -> None:
        try:
            with jobs.stage(job_id,'semantic-model',mirror=False,total=1) as child:
                processor, model, device, revision, manifest = self._load_model(allow_download, child)
                jobs.check(child)
                with self.lock:
                    self.processor,self.model,self.device = processor,model,device
                    self.model_revision,self.model_manifest = revision,manifest
                    self._index = self._index_fingerprint = None
                    self._vectors.clear()
                jobs.update(child,processed=1,success=1)
            with jobs.stage(job_id,'semantic-photos') as child:
                self._index_rounds(child)
        except Exception as error:
            self._task_error(error,job_id)
            raise

    def _load_model(self, allow_download: bool, job_id: str):
        jobs.check(job_id)
        import torch
        from transformers import ChineseCLIPModel, ChineseCLIPProcessor
        from huggingface_hub import snapshot_download
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.update(stage='检查本地缓存 / 下载模型（仅下载模型，不上传照片）')
        jobs.update(job_id,current='检查本地缓存 / 下载模型（仅下载模型，不上传照片）')
        location = snapshot_download(self.model_name, cache_dir=str(MODELS), local_files_only=not allow_download,
            allow_patterns=['config.json', 'preprocessor_config.json', 'tokenizer_config.json', 'special_tokens_map.json',
                            'vocab.txt', 'tokenizer.json', 'model.safetensors', 'pytorch_model.bin'])
        jobs.check(job_id)
        revision, manifest = model_manifest(location, self.model_name)
        jobs.check(job_id)
        self.update(stage='加载 Chinese-CLIP')
        jobs.update(job_id,current='加载 Chinese-CLIP')
        processor = ChineseCLIPProcessor.from_pretrained(location, local_files_only=True, backend='pil', trust_remote_code=False)
        jobs.check(job_id)
        model = ChineseCLIPModel.from_pretrained(location, local_files_only=True, trust_remote_code=False).to(device).eval()
        jobs.check(job_id)
        if model_manifest(location,self.model_name)[0]!=revision:
            raise ValueError('本地语义模型在加载时发生变化，请重新准备模型')
        return processor,model,device,revision,manifest

    def index_if_ready(self) -> None:
        self.refresh_task_state()
        with self.lock:
            if self.model is None or self.state['status'] not in ('ready', 'indexing'):
                return
            self._index_again = True
            if self._index_queued:
                return
            self._index_queued = True
            self.state.update(status='indexing',stage='等待本地语义索引',error=None)
            try:
                job=jobs.submit('semantic-index',self._index_task,executor=self.pool,resource='local-ai')
                self.task_id=job['id']
            except Exception as error:
                # Index admission must not fail an otherwise completed import.
                self._index_queued = False
                self.state.update(status='ready',stage='未能创建本地语义任务',error=str(error))

    def _index_task(self, job_id: str) -> None:
        try:
            with jobs.stage(job_id,'semantic-photos') as child:
                self._index_rounds(child)
        except Exception as error:
            self._task_error(error,job_id)
            raise

    def _index_rounds(self, job_id: str) -> None:
        while True:
            jobs.check(job_id)
            with self.lock:
                self._index_again=False
            self.index(job_id)
            jobs.check(job_id)
            with self.lock:
                if not self._index_again:
                    self._index_queued=False
                    self.state.update(status='ready',stage='本地语义索引已就绪')
                    return

    def index(self, job_id: str | None = None) -> None:
        if self.model is None:
            return
        import torch
        if job_id:jobs.check(job_id)
        with Session() as session:
            photos = session.scalars(select(Photo).join(CaptureGroup, CaptureGroup.preferred_photo_id == Photo.id)).all()
            sources = {p.id:p for p in photos}
            done = {e.photo_id for e in session.scalars(select(Embedding).where(Embedding.model == self.model_name))
                    if e.photo_id in sources and self.entry_vector(e,sources[e.photo_id],self.model.config.projection_dim) is not None}
        todo = [p for p in photos if p.id not in done and p.preview_path]
        indexed, failed = len(done), 0
        initial=indexed
        self.update(status='indexing', stage='在本机分析照片', total=len(todo), processed=0, indexed=indexed, failed=0)
        prior=jobs.get(job_id) if job_id else {}
        processed_before=prior.get('processed',0)
        success_before=prior.get('success',0)
        failed_before=prior.get('failed',0)
        if job_id:jobs.update(job_id,total=processed_before+len(todo),processed=processed_before,success=success_before,failed=failed_before,current='在本机分析照片')
        for i, photo in enumerate(todo):
            if job_id:jobs.check(job_id)
            try:
                if job_id:jobs.update(job_id,current=photo.file_name)
                signature = source_signature(photo.file_path)
                if file_hash(photo.file_path) != photo.file_hash:
                    raise ValueError('原片已改变，请重新核验图库后建立语义索引')
                revision = self.model_revision
                if not revision:
                    raise ValueError('本地语义索引版本未验证，请重新准备模型')
                input_signature=source_signature(photo.preview_path)
                input_hash=file_hash(photo.preview_path)
                image = open_image(Path(photo.preview_path))
                try:
                    with self.lock, torch.inference_mode():
                        inputs = self.processor(images=image, return_tensors='pt').to(self.device)
                        features = self.model.get_image_features(**inputs)
                        features = getattr(features,'pooler_output',features)
                        vector = features[0].float().cpu().numpy()
                finally:
                    image.close()
                if job_id:jobs.check(job_id)
                if (vector.ndim!=1 or len(vector)!=self.model.config.projection_dim
                        or not np.isfinite(vector).all() or np.linalg.norm(vector)<=1e-8):
                    raise ValueError('本地语义向量无效，未保存')
                vector = vector.astype('float32') / float(np.linalg.norm(vector))
                if signature!=source_signature(photo.file_path) or file_hash(photo.file_path)!=photo.file_hash:
                    raise ValueError('原片已改变，请重新核验图库后建立语义索引')
                if input_signature!=source_signature(photo.preview_path) or input_hash!=file_hash(photo.preview_path):
                    raise ValueError('照片预览已改变，请重新建立语义索引')
                target = DATA / 'embeddings' / f'{photo.id}-{revision[:16]}-{photo.file_hash[:16]}.npy'
                descriptor, temporary = tempfile.mkstemp(prefix='vector-',suffix='.npy',dir=target.parent)
                try:
                    with os.fdopen(descriptor,'wb') as stream:
                        np.save(stream,vector,allow_pickle=False)
                        stream.flush();os.fsync(stream.fileno())
                    digest=file_hash(temporary)
                    os.replace(temporary,target)
                finally:
                    Path(temporary).unlink(missing_ok=True)
                if job_id:jobs.check(job_id)
                with Session() as session:
                    current=session.get(Photo, photo.id)
                    if (current and current.file_hash==photo.file_hash and current.preview_path==photo.preview_path
                            and self.model_revision==revision):
                        session.merge(Embedding(photo_id=photo.id, model=self.model_name, embedding_path=str(target),
                            model_revision=revision,source_hash=photo.file_hash,source_signature=signature,
                            input_hash=input_hash,input_signature=input_signature,
                            dimensions=len(vector),vector_hash=digest))
                        session.commit()
                        indexed += 1
            except jobs.JobCancelled:
                raise
            except Exception as error:
                failed += 1
                self.update(error=str(error))
            self.update(processed=i+1, indexed=indexed, failed=failed)
            if job_id:jobs.update(job_id,processed=processed_before+i+1,success=success_before+indexed-initial,failed=failed_before+failed)
        with self.lock:
            self._index = None
        if not job_id:self.update(status='ready', stage='本地语义索引已就绪')

    def search(self, keywords: list[str], mode: str, threshold: float, maximum: int | None) -> list[dict]:
        if (mode not in ('any','all') or not np.isfinite(threshold) or not -1<=threshold<=1
                or (maximum is not None and (type(maximum) is not int or maximum<1))):
            raise ValueError('语义检索参数无效')
        if self.model is None or self.state['status'] not in ('ready', 'indexing'):
            raise ValueError('请在设置中加载本地 AI 模型并建立索引；不会使用文件名冒充语义搜索')
        import torch
        with self.lock, torch.inference_mode():
            revision=self.model_revision
            inputs = self.processor(text=keywords, padding=True, truncation=True, max_length=52, return_tensors='pt').to(self.device)
            features = self.model.get_text_features(**inputs)
            features = getattr(features,'pooler_output',features).float().cpu().numpy()
            if (features.ndim!=2 or features.shape!=(len(keywords),self.model.config.projection_dim)
                    or not np.isfinite(features).all() or np.any(np.linalg.norm(features,axis=1)<=1e-8)):
                raise ValueError('本地语义向量无效，未保存')
        return self._search_features(features,mode,threshold,maximum,revision)

    def image_similar(self,photo_id,threshold=.3,maximum=60):
        if not np.isfinite(threshold) or not -1<=threshold<=1 or (maximum is not None and (type(maximum) is not int or not 1<=maximum<=200)):
            raise ValueError('语义检索参数无效')
        if self.model is None or self.state['status'] not in ('ready','indexing'):
            raise ValueError('请在设置中加载本地 AI 模型并建立索引；不会使用文件名冒充语义搜索')
        revision=self.model_revision
        with Session() as session:
            photo=session.get(Photo,photo_id)
            if photo is None:raise ValueError('Photo record no longer exists.')
            group=session.get(CaptureGroup,photo.capture_group_id)
            photo=session.get(Photo,group.preferred_photo_id)
            entry=session.get(Embedding,(photo.id,self.model_name))
            vector=self.entry_vector(entry,photo,self.model.config.projection_dim) if entry else None
            if vector is None:raise ValueError('Rebuild the local semantic index before searching this photo.')
            source_id=photo.id
        return [row for row in self._search_features(vector[None,:],'any',threshold,None,revision) if row['photo_id']!=source_id][:maximum]

    def _search_features(self,features,mode,threshold,maximum,revision):
        if not revision or revision!=self.model_revision:raise ValueError('本地语义索引版本未验证，请重新准备模型')
        with Session() as session:
            from sqlalchemy.orm import load_only
            pairs=session.execute(select(Embedding,Photo).join(Photo,Photo.id==Embedding.photo_id).join(
                CaptureGroup,CaptureGroup.preferred_photo_id==Photo.id).where(Embedding.model==self.model_name).options(
                load_only(Photo.id,Photo.file_path,Photo.file_hash,Photo.preview_path))).all()
            entries=[entry for entry,_ in pairs];sources={photo.id:photo for _,photo in pairs}
        entries = [e for e in entries if e.photo_id in sources and self.entry_vector(e,sources[e.photo_id],features.shape[1]) is not None]
        faiss = self.faiss_module()
        if faiss is not None:
            with self.lock:
                if revision!=self.model_revision:raise ValueError('本地语义索引版本未验证，请重新准备模型')
                return self._search_faiss(faiss, entries, features, mode, threshold, maximum)
        ranked = []
        # Bound memory for large libraries; never re-encode images during search.
        for offset in range(0, len(entries), 512):
            valid, vectors = [], []
            for item in entries[offset:offset+512]:
                vector = self.cached_vector(item, features.shape[1])
                if vector is not None:
                    vectors.append(vector)
                    valid.append(item)
            if vectors:
                scores = similarity_scores(np.stack(vectors), features, mode)
                ranked.extend(dict(photo_id=item.photo_id, similarity_score=float(score)) for item, score in zip(valid, scores) if score >= threshold)
        if revision!=self.model_revision:raise ValueError('本地语义索引版本未验证，请重新准备模型')
        return sorted(ranked, key=lambda item: (-item['similarity_score'], item['photo_id']))[:maximum]

    def entry_vector(self, entry, photo, dimension):
        if (not self.model_revision or entry.model_revision!=self.model_revision
                or entry.source_hash!=photo.file_hash or entry.dimensions!=dimension or not entry.vector_hash
                or not entry.input_hash or not photo.preview_path):
            return None
        try:
            if (entry.source_signature!=source_signature(photo.file_path)
                    or entry.input_signature!=source_signature(photo.preview_path)
                    or file_hash(entry.embedding_path)!=entry.vector_hash):
                return None
        except OSError:
            return None
        key=(entry.embedding_path,entry.vector_hash,dimension)
        with self.lock:
            vector=self._vectors.get(key)
            if vector is not None:self._vectors.move_to_end(key);return vector
        vector=self.load_vector(entry.embedding_path,dimension)
        try:
            if vector is not None and file_hash(entry.embedding_path)!=entry.vector_hash:return None
        except OSError:return None
        if vector is not None:
            vector.setflags(write=False)
            with self.lock:
                self._vectors[key]=vector
                while len(self._vectors)>4096:self._vectors.popitem(last=False)
        return vector

    def cached_vector(self,entry,dimension):
        with self.lock:
            result=self._vectors.get((entry.embedding_path,entry.vector_hash,dimension))
        if result is not None:return result
        result=self.load_vector(entry.embedding_path,dimension)
        try:return result if result is not None and file_hash(entry.embedding_path)==entry.vector_hash else None
        except OSError:return None

    @staticmethod
    def load_vector(path: str, dimension: int | None = None) -> np.ndarray | None:
        try:
            if Path(path).stat().st_size>65536+(dimension or 16384)*8:return None
            loaded = np.load(path, allow_pickle=False)
            if not isinstance(loaded,np.ndarray):
                if hasattr(loaded,'close'):loaded.close()
                return None
            vector=loaded.astype('float32')
            if vector.ndim != 1 or (dimension is not None and len(vector) != dimension) or not np.isfinite(vector).all():
                return None
            norm = float(np.linalg.norm(vector))
            return vector / norm if norm > 1e-8 else None
        except (OSError, ValueError, TypeError, EOFError):
            return None

    def _search_faiss(self, faiss, entries, features: np.ndarray, mode: str, threshold: float, maximum: int) -> list[dict]:
        fingerprint = []
        for item in entries:
            try:
                stat = Path(item.embedding_path).stat()
                fingerprint.append((item.photo_id,item.embedding_path,stat.st_mtime_ns,stat.st_size,getattr(item,'vector_hash','')))
            except OSError:
                fingerprint.append((item.photo_id,item.embedding_path,None,None,getattr(item,'vector_hash','')))
        fingerprint = (self.model_name,self.model_revision,features.shape[1],tuple(sorted(fingerprint)))
        if self._index is None or self._index_fingerprint != fingerprint:
            ids, vectors = [], []
            for item in entries:
                vector = self.cached_vector(item,features.shape[1]) if hasattr(item,'vector_hash') else self.load_vector(item.embedding_path,features.shape[1])
                if vector is not None:
                    vectors.append(vector)
                    ids.append(item.photo_id)
            if not vectors:
                return []
            matrix = np.stack(vectors).astype('float32')
            self._index = faiss.IndexFlatIP(matrix.shape[1])
            self._index.add(matrix)
            self._index_ids, self._index_model = ids, self.model_name
            self._index_fingerprint = fingerprint
        queries = features / np.maximum(np.linalg.norm(features, axis=1, keepdims=True), 1e-8)
        # Exact AND needs every score, including items below either term's top-k.
        k = len(self._index_ids)
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
        return sorted(ranked, key=lambda item: (-item['similarity_score'], item['photo_id']))[:maximum]

service = EmbeddingService()
