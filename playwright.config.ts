import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? '4173')
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('PLAYWRIGHT_PORT must be an integer from 1024 to 65535.')
}
const appURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: appURL,
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
    reuseExistingServer: false,
    url: appURL,
  },
})
