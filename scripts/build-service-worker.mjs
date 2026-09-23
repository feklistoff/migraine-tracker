/* global URL, process, console */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const output = new URL('../dist/', import.meta.url)
const template = new URL('../src/pwa/service-worker.js', import.meta.url)
const configuredBase = process.env.VITE_BASE_PATH ?? '/'
const base = configuredBase === '/' ? '/' : `/${configuredBase.replace(/^\/+|\/+$/g, '')}/`

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const results = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  }))
  return results.flat()
}

const paths = (await files(output.pathname)).filter((path) => !path.endsWith('/sw.js') && !path.endsWith('.map'))
const names = paths.map((path) => relative(output.pathname, path).replaceAll('\\', '/')).sort()
const hash = createHash('sha256')
for (const name of names) {
  hash.update(name)
  hash.update(await readFile(new URL(name, output)))
}
const revision = hash.digest('hex').slice(0, 16)
const precache = [...new Set([base, ...names.map((name) => `${base}${name}`)])]
const source = (await readFile(template, 'utf8'))
  .replaceAll('__BASE_PATH__', JSON.stringify(base))
  .replaceAll('__PRECACHE__', JSON.stringify(precache))
  .replaceAll('__CACHE_NAME__', JSON.stringify(`headache-diary-shell:${base}:${revision}`))
await writeFile(new URL('sw.js', output), source)
console.log(`Service worker ${revision}: ${precache.length} local files`)
