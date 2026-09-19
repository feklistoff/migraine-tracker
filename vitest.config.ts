import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

process.env.TZ = 'UTC'

export default defineConfig({
  plugins: [react()],
  test: {
    clearMocks: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
