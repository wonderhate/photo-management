import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const library=join(root,'.test-artifacts',`theme-browser-${process.pid}`);

export default defineConfig({
  testDir:'./tests',testMatch:['theme.spec.mjs','i18n.spec.mjs','rebuild.spec.mjs','signature.spec.mjs','local-access.spec.mjs','art.spec.mjs'],workers:1,
  outputDir:'../verification/theme',
  use:{baseURL:'http://127.0.0.1:4174',channel:process.env.CI?undefined:'chrome',headless:true,serviceWorkers:'block',trace:'retain-on-failure'},
  webServer:{command:`"${process.env.PHOTO_TEST_PYTHON||'python'}" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 4174`,cwd:root,
    env:{PHOTO_DATA_DIR:library,PHOTO_LIBRARY_CONFIG:join(library,'config.json'),PHOTO_MODELS_DIR:join(library,'models'),PHOTO_EXPORT_DIR:join(library,'exports'),PHOTO_AUTOLOAD_AI:'0'},
    url:'http://127.0.0.1:4174',reuseExistingServer:false},
});
