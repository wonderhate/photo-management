import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const library=join(root,'.test-artifacts',`theme-browser-${process.pid}`);

export default defineConfig({
  testDir:'./tests',testMatch:['theme.spec.mjs','rebuild.spec.mjs'],workers:1,
  outputDir:'../verification/theme',
  // Mocked photo responses must stay in Playwright's routing rather than a service worker.
  use:{baseURL:'http://127.0.0.1:4176',channel:'chrome',headless:true,serviceWorkers:'block',trace:'retain-on-failure'},
  webServer:{command:`"${process.env.PHOTO_TEST_PYTHON||'python'}" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 4176`,cwd:root,
    env:{PHOTO_DATA_DIR:library,PHOTO_MODELS_DIR:join(library,'models'),PHOTO_EXPORT_DIR:join(library,'exports'),PHOTO_AUTOLOAD_AI:'0'},
    url:'http://127.0.0.1:4176',reuseExistingServer:false},
});
