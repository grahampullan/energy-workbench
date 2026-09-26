import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node scripts/serve-workbench.js",
    url: "http://127.0.0.1:4174",
    env: { PORT: "4174" }
  }
});
