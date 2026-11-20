import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a separate dev server in DEMO mode (fake data),
 * so they never touch real accounts. Uses your installed Chrome.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    timezoneId: "America/New_York",
  },
  projects: [
    { name: "mac", use: { viewport: { width: 1440, height: 900 } } },
    { name: "iphone", use: { ...devices["iPhone 15"], browserName: "chromium", channel: "chrome" } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { DEMO_MODE: "1", NEXT_DIST_DIR: ".next-e2e" },
  },
});
