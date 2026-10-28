import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
// Windows can reuse process IDs from an earlier run whose fixture library remains.
const library=join(root,'.test-artifacts',`theme-browser-${process.pid}-${randomUUID()}`);

export default defineConfig({
  testDir:'./tests',testMatch:['liquid-glass.spec.mjs','final-runtime.spec.mjs','vision-agent.spec.mjs','ai-studio.spec.mjs','similarity-analysis.spec.mjs','media-frames.spec.mjs','collage.spec.mjs','theme.spec.mjs','i18n.spec.mjs','rebuild.spec.mjs','signature.spec.mjs','local-access.spec.mjs','art.spec.mjs','workspace.spec.mjs','desktop-editor.spec.mjs','display-preview.spec.mjs','capabilities.spec.mjs','catalogs.spec.mjs','progressive.spec.mjs','recent.spec.mjs','viewer.spec.mjs','compare.spec.mjs','commands.spec.mjs','photo-order.spec.mjs','rule-collection.spec.mjs','album-list.spec.mjs','album-overview.spec.mjs','xmp-rating.spec.mjs','photo-flags.spec.mjs','annotations.spec.mjs','text-search.spec.mjs','facets.spec.mjs','query-scope.spec.mjs','tag-search.spec.mjs','face-spaces.spec.mjs','face-management.spec.mjs','face-ignore.spec.mjs','person-scope.spec.mjs','photo-activation.spec.mjs','import-faces.spec.mjs','composition.spec.mjs','split-worker.spec.mjs','split-ui.spec.mjs'],workers:1,
  outputDir:'../verification/theme',
  use:{baseURL:'http://127.0.0.1:4174',channel:process.env.CI?undefined:'chrome',headless:true,serviceWorkers:'block',trace:'retain-on-failure'},
  webServer:{command:`"${process.env.PHOTO_TEST_PYTHON||'python'}" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 4174`,cwd:root,
    env:{PHOTO_DATA_DIR:library,PHOTO_LIBRARY_CONFIG:join(library,'config.json'),PHOTO_MODELS_DIR:join(library,'models'),PHOTO_EXPORT_DIR:join(library,'exports'),PHOTO_AUTOLOAD_AI:'0'},
    url:'http://127.0.0.1:4174',reuseExistingServer:false},
});
