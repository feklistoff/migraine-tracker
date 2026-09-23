import { existsSync, realpathSync } from 'node:fs'

import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

const configuredBase = process.env.VITE_BASE_PATH ?? '/'
const base =
  configuredBase === '/'
    ? '/'
    : `/${configuredBase.replace(/^\/+|\/+$/g, '')}/`

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    fs: {
      // Worktrees may link the root installation; Vite otherwise rejects its local fonts.
      allow: [searchForWorkspaceRoot(process.cwd()), ...(existsSync('node_modules') ? [realpathSync('node_modules')] : [])],
    },
  },
})
