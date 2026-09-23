import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { log } from 'node:console'
import { URL } from 'node:url'
import { JSDOM } from 'jsdom'

// Parse the emitted artifact without executing its scripts or fetching resources.
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
const { document, Node } = new JSDOM(html).window
const policies = document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
assert.equal(policies.length, 1, 'Production HTML must have exactly one CSP')
const policy = policies[0]
const directives = new Map()
for (const directive of policy.content.split(';').map((part) => part.trim()).filter(Boolean)) {
  const [name, ...values] = directive.split(/\s+/)
  assert(!directives.has(name), `Duplicate CSP directive: ${name}`)
  directives.set(name, values)
}
for (const [name, values] of Object.entries({
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
})) {
  assert.deepEqual(directives.get(name), values, `Unexpected production CSP ${name}`)
}
for (const name of ['script-src-elem', 'script-src-attr']) {
  assert(!directives.has(name), `${name} must not override script-src`)
}
const scripts = document.querySelectorAll('script')
assert(scripts.length > 0, 'Production HTML must load app scripts')
for (const script of scripts) {
  assert(script.getAttribute('src')?.trim(), 'Production HTML must not contain inline scripts')
  assert(policy.compareDocumentPosition(script) & Node.DOCUMENT_POSITION_FOLLOWING,
    'CSP must precede every production script')
}
assert.equal(document.querySelector('meta[name="robots"]')?.content, 'noindex, nofollow')
log('Production HTML security checks passed')
