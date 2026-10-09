"""Repeatable local-model verification. Uses the configured library, changes no originals."""
import json
from pathlib import Path
from sqlalchemy import select
from backend.app.models import initialize, Session, Photo, Embedding
from backend.app.services.embedding_service import service
from backend.app.config import PROJECT

def main() -> None:
    initialize()
    service._prepare(False)
    status=service.status()
    if status['status']!='ready': raise RuntimeError(status['error'])
    with Session() as session:
        names={p.id:p.file_name for p in session.scalars(select(Photo))}
        files=[Path(e.embedding_path) for e in session.scalars(select(Embedding))]
    before={str(p):p.stat().st_mtime_ns for p in files}
    result={'model':status['model'],'device':status['device'],'indexed':status['indexed'],'queries':{}}
    for terms,mode in [(['城市夜景'],'any'),(['演唱会'],'any'),(['日落'],'any'),(['城市','夜晚'],'all'),(['猫','狗'],'any')]:
        matches=service.search(terms,mode,.1,5)
        result['queries'][' '+mode+' '+','.join(terms)]=[{**m,'file_name':names.get(m['photo_id'])} for m in matches]
    after={str(p):p.stat().st_mtime_ns for p in files}
    assert before==after,'Searching must not re-encode or rewrite embeddings'
    result['search_reused_embeddings']=True
    output=PROJECT/'verification';output.mkdir(exist_ok=True)
    (output/'ai-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps(result,ensure_ascii=True,indent=2))

if __name__=='__main__':main()
