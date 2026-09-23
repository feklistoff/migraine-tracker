/* global URL, process, navigator, caches, console, setTimeout */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, expect } from '@playwright/test'

const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = await mkdtemp(join(tmpdir(), 'headache-diary-pwa-'))
const port = Number(process.env.PLAYWRIGHT_PORT ?? '4176')
const base = '/migraine-tracker/'
const origin = `http://127.0.0.1:${port}`
let active = join(scratch, 'A')
let browser
let server

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, VITE_BASE_PATH: base, VITE_BUILD_LABEL: label },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
}

async function build(label) {
  run(['node_modules/vite/bin/vite.js', 'build'], label)
  run(['scripts/build-service-worker.mjs'], label)
  await cp(join(root, 'dist'), join(scratch, label), { recursive: true })
}

function mime(path) {
  return ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(path)] ?? 'application/octet-stream'
}

function startServer() {
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, origin).pathname
    if (!pathname.startsWith(base)) { response.writeHead(404).end(); return }
    const relativePath = pathname.slice(base.length) || 'index.html'
    const path = resolve(active, relativePath)
    if (!path.startsWith(`${active}${sep}`)) { response.writeHead(403).end(); return }
    try {
      if (!(await stat(path)).isFile()) throw new Error('not file')
      response.setHeader('Content-Type', mime(path))
      response.setHeader('Cache-Control', path.endsWith('sw.js') ? 'no-cache' : 'no-store')
      response.end(await readFile(path))
    } catch {
      response.writeHead(404).end()
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
}

try {
  console.log('Building A and B')
  await build('A')
  await build('B')
  active = join(scratch, 'A')
  await startServer()
  console.log('Opening build A')
  browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  let page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.setDefaultNavigationTimeout(10000)
  const external = []
  context.on('request', (request) => { if (!request.url().startsWith(origin)) external.push(request.url()) })

  await page.goto(`${origin}${base}`)
  console.log('Build A loaded, waiting for worker')
  await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('worker ready timeout')), 10000))]))
  await page.reload()
  console.log('Build A controlled')
  assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true, 'first build must control the page')
  await expect(page.getByRole('heading', { name: 'Nothing recorded yet.' })).toBeVisible()
  await page.getByRole('link', { name: 'Start a headache' }).click()
  await expect(page.getByRole('heading', { name: 'New headache' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Today' }).click()
  await expect(page.getByRole('heading', { name: 'Headache ongoing' })).toBeVisible()
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Words' }).click()
  await expect(page.getByRole('button', { name: 'Words' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('A', { exact: true })).toBeVisible()
  await page.close()
  console.log('Saved onset and settings')

  await context.setOffline(true)
  page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.setDefaultNavigationTimeout(10000)
  await page.goto(`${origin}${base}`)
  console.log('Offline cold reopen loaded')
  await expect(page.getByRole('heading', { name: 'Headache ongoing' })).toBeVisible()
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: 'Words' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '90 min' }).click()
  await expect(page.getByRole('button', { name: '90 min' })).toHaveAttribute('aria-pressed', 'true')
  await context.setOffline(false)

  await page.getByRole('link', { name: 'Back to Today' }).click()
  await page.getByRole('link', { name: 'Edit start' }).click()
  await expect(page.getByRole('heading', { name: 'New headache' })).toBeVisible()
  const oldAsset = (await readdir(join(scratch, 'A', 'assets'))).find((name) => /^index-.*\.js$/.test(name))
  assert(oldAsset)
  active = join(scratch, 'B')
  console.log('Serving build B')
  await page.evaluate(() => navigator.serviceWorker.ready.then((registration) => registration.update()))
  await expect(page.getByRole('status', { name: 'App update available' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Update now' })).toBeDisabled()
  console.log('Update deferred on entry form')
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state), 'installed')

  const secondPage = await context.newPage()
  await secondPage.goto(`${origin}${base}`)
  await secondPage.getByRole('link', { name: 'Edit start' }).click()
  await expect(secondPage.getByRole('heading', { name: 'New headache' })).toBeVisible()

  page.on('dialog', (dialog) => void dialog.accept())
  await page.getByRole('link', { name: 'Back to Today' }).click()
  await expect(page.getByRole('button', { name: 'Update now' })).toBeEnabled()
  await page.getByRole('button', { name: 'Update now' }).click()
  await expect(page.getByText('Finish open forms and diary changes in every app tab, then try again.')).toBeVisible()
  await secondPage.close()
  await page.getByRole('button', { name: 'Update now' }).click()
  console.log('Update requested')
  await expect(page.getByRole('heading', { name: 'Headache ongoing' })).toBeVisible()
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByText('B', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Words' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '90 min' })).toHaveAttribute('aria-pressed', 'true')
  assert.equal(await page.evaluate(async (path) => Boolean(await caches.match(path)), `${base}assets/${oldAsset}`), true, 'old assets must remain while a tab is open')
  assert.deepEqual(external, [], 'no font, analytics or diary request may leave the app origin')
  console.log('PWA production test passed: offline cold reopen/write, data/settings retention, two-tab update deferral, old asset retention')
  await context.close()
} finally {
  await browser?.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  await rm(scratch, { recursive: true, force: true })
}
