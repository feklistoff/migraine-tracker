import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const configuredBase = process.env.VITE_BASE_PATH ?? '/'
const base =
  configuredBase === '/'
    ? '/'
    : `/${configuredBase.replace(/^\/+|\/+$/g, '')}/`

export default defineConfig({
  base,
  plugins: [react()],
})
