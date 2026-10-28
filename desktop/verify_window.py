"""Actual WebView2 readiness and legacy routes in an isolated retained profile."""
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4


def main():
    root=Path(__file__).resolve().parents[1]
    exe=Path(sys.argv[1]).resolve(strict=True)
    work=root/'.test-artifacts'/('frozen-window-'+str(uuid4()));work.mkdir()
    env={k:v for k,v in os.environ.items() if k not in ('DASHSCOPE_API_KEY','OPENAI_API_KEY')}
    env.update(LOCALAPPDATA=str(work/'profile'),PHOTO_DATA_DIR=str(work/'data'),PHOTO_LIBRARY_CONFIG=str(work/'config.json'),
        PHOTO_MODELS_DIR=str(work/'models'),PHOTO_EXPORT_DIR=str(work/'exports'),PHOTO_AUTOLOAD_AI='0')
    results=[]
    for index,path in enumerate(['/','/watercolor','/watermark/gallery','/tools/analyze','/tools/raw','/tools/edit']):
        status=work/f'window-{index}.json'
        subprocess.run([str(exe),'--window-check','--window-check-path',path,'--status-file',str(status)],
            env=env,check=True,timeout=90,creationflags=subprocess.CREATE_NO_WINDOW)
        state=json.loads(status.read_text('utf-8'))
        assert Path(state['data_dir'])==work/'data'
        assert all(state.get(key) for key in ('window_loaded','app_ready','isolated','wasm','worker')),state
        assert state['path']==path,state
        results.append({'path':path,'build_id':state['build_id'],'passed':True})
        print('Native WebView2:',path,'React readiness, isolation, Worker and WASM PASS',flush=True)
    (work/'results.json').write_text(json.dumps(results,indent=2),'utf-8')
    print('Retained synthetic evidence:',work,flush=True)


if __name__=='__main__':main()
