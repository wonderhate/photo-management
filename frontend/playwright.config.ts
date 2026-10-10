import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./tests',testMatch:'theme.spec.mjs',workers:1,
  outputDir:'../verification/theme',
  use:{baseURL:'http://127.0.0.1:4174',headless:true,trace:'retain-on-failure'},
  webServer:{command:'npm run preview -- --port 4174 --strictPort',url:'http://127.0.0.1:4174',reuseExistingServer:false},
});
