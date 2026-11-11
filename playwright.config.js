import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';
export default defineConfig({
  testDir:'test', testMatch:'browser.spec.js', workers:1, reporter:'list',
  use:{baseURL, launchOptions:process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}},
  webServer:{command:'npm run dev',url:baseURL,reuseExistingServer:false,timeout:30000}
});
