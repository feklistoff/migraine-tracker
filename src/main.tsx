import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import { PwaStatus } from './pwa/PwaStatus'
import '@fontsource-variable/figtree'
import '@fontsource-variable/fraunces'
import './styles/global.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('The application root element is missing.')
}

createRoot(root).render(
  <StrictMode>
    <App />
    <PwaStatus />
  </StrictMode>,
)
