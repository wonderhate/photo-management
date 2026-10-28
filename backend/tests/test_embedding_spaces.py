"""Identity/integrity tests use synthetic bytes, never downloaded model weights."""
from types import SimpleNamespace
import numpy as np
from backend.app.services.embedding_space import file_hash, model_manifest, source_signature
from backend.app.services.embedding_service import EmbeddingService


def test_model_revision_changes_when_weights_or_processor_change(tmp_path):
    (tmp_path/'config.json').write_text('{"projection_dim":3}')
    weights=tmp_path/'model.safetensors';weights.write_bytes(b'synthetic model identity only')
    first,manifest=model_manifest(tmp_path,'synthetic/model')
    assert first==model_manifest(tmp_path,'synthetic/model')[0]
    assert first!=model_manifest(tmp_path,'different/model')[0]
    (tmp_path/'preprocessor_config.json').write_text('{"size":224}')
    second=model_manifest(tmp_path,'synthetic/model')[0]
    assert second!=first
    weights.write_bytes(b'revised synthetic model')
    assert model_manifest(tmp_path,'synthetic/model')[0]!=second
    assert all(not f['path'].startswith(str(tmp_path)) for f in manifest['files'])


def test_vector_provenance_rejects_legacy_other_revision_source_and_corruption(tmp_path):
    source=tmp_path/'synthetic-source.bin';source.write_bytes(b'original fixture')
    vector=tmp_path/'vector.npy';np.save(vector,np.array([1.,2.,3.],dtype='float32'))
    preview=tmp_path/'preview.jpg';preview.write_bytes(b'synthetic preview identity')
    photo=SimpleNamespace(file_path=str(source),file_hash=file_hash(source),preview_path=str(preview))
    entry=SimpleNamespace(embedding_path=str(vector),model_revision='rev1',source_hash=photo.file_hash,
                          source_signature=source_signature(source),vector_hash=file_hash(vector),dimensions=3,
                          input_hash=file_hash(preview),input_signature=source_signature(preview))
    instance=EmbeddingService();instance.model_revision='rev1'
    try:
        assert instance.entry_vector(entry,photo,3) is not None
        for revision in ('','rev2'):
            entry.model_revision=revision
            assert instance.entry_vector(entry,photo,3) is None
        entry.model_revision='rev1'
        assert instance.entry_vector(entry,photo,4) is None
        old=entry.source_hash;entry.source_hash='other-source'
        assert instance.entry_vector(entry,photo,3) is None
        entry.source_hash=old
        np.save(vector,np.array([3.,2.,1.],dtype='float32'))
        assert instance.entry_vector(entry,photo,3) is None
        entry.vector_hash=file_hash(vector)
        assert instance.entry_vector(entry,photo,3) is not None
        source.write_bytes(b'original fixture edited outside application')
        assert instance.entry_vector(entry,photo,3) is None
    finally:instance.pool.shutdown()
