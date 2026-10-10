from types import SimpleNamespace
import numpy as np
from backend.app.services.embedding_service import EmbeddingService, similarity_scores, service
from test_library import import_paths


class ExactIndex:
    def __init__(self, dimension): pass
    def add(self, matrix): self.matrix=matrix
    def search(self, queries, k):
        scores=queries @ self.matrix.T
        positions=np.argsort(-scores,axis=1)[:,:k]
        return np.take_along_axis(scores,positions,axis=1),positions


def test_faiss_exact_and_cache_replacement_and_corrupt_vectors(tmp_path):
    instance=EmbeddingService()
    vectors=np.vstack([np.tile([.95,.05,np.sqrt(.095)],(500,1)),np.tile([.05,.95,np.sqrt(.095)],(500,1)),[.7,.7,np.sqrt(.02)]])
    entries=[]
    for i,vector in enumerate(vectors):
        path=tmp_path/f'{i}.npy';np.save(path,vector*2)
        entries.append(SimpleNamespace(photo_id=str(i),embedding_path=str(path)))
    fake=SimpleNamespace(IndexFlatIP=ExactIndex)
    queries=np.array([[1,0,0],[0,1,0]],dtype='float32')
    actual=instance._search_faiss(fake,entries,queries,'all',.6,1)
    assert actual[0]['photo_id']=='1000'
    assert np.isclose(actual[0]['similarity_score'],similarity_scores(vectors,queries,'all')[-1])
    entries[-1]=SimpleNamespace(photo_id='replacement',embedding_path=entries[-1].embedding_path)
    assert instance._search_faiss(fake,entries,queries,'all',.6,1)[0]['photo_id']=='replacement'
    bad=tmp_path/'bad.npy';np.save(bad,np.array([np.nan,0,0]))
    assert instance.load_vector(str(bad),3) is None
    for mode in ('all','any'):
        expected=similarity_scores(vectors,queries,mode)
        result=instance._search_faiss(fake,entries,queries,mode,0,1001)
        assert len(result)==len(vectors)
        assert all(np.isclose(row['similarity_score'],expected[1000 if row['photo_id']=='replacement' else int(row['photo_id'])]) for row in result)
    instance.pool.shutdown()


def test_natural_query_preserves_subject_and_intersects_metadata(client,image_factory,monkeypatch):
    import_paths(client,[image_factory('one.jpg',focal=50),image_factory('two.jpg',focal=85,color=(2,3,4))])
    parsed=client.get('/api/search/parse',params={'q':'2026年9月 50mm 日落'}).json()
    assert parsed['filters']['focal_length']=='50' and parsed['remaining_query']=='日落'
    assert parsed['filters']['semantic']=='日落'
    photos=client.get('/api/photos').json()['photos']
    monkeypatch.setattr(service,'search',lambda *args:[{'photo_id':p['id'],'similarity_score':.5} for p in photos])
    assert client.get('/api/photos',params=parsed['filters']).json()['total']==1
    assert client.get('/api/search/parse',params={'q':'2026年13月'}).status_code==400
