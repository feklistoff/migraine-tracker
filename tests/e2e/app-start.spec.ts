import { expect, test } from '@playwright/test'

test('app starts with an empty diary shell', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1, name: 'Headache diary' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeVisible()
})

test('spike route advertises a spike-specific install manifest', async ({ page }) => {
  await page.goto('/?spike=1')

  const manifestLink = page.locator('link[rel="manifest"]')
  await expect(manifestLink).toHaveAttribute('href', /spike-manifest\.webmanifest/)

  const manifestUrl = await manifestLink.getAttribute('href')
  expect(manifestUrl).not.toBeNull()
  const manifestResponse = await page.request.get(new URL(manifestUrl!, page.url()).toString())
  expect(manifestResponse.ok()).toBeTruthy()
  await expect(manifestResponse.json()).resolves.toMatchObject({ start_url: './?spike=1' })
})

test('document has a restrictive CSP and no inline scripts', async ({ page }) => {
  await page.goto('/')

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("script-src 'self'")
  expect(csp).toContain("connect-src 'self'")
  expect(csp).toContain("object-src 'none'")
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await expect(page.locator('script[src$="manifest-selector.js"]')).toHaveCount(1)

  const inlineScriptBodies = await page.locator('script:not([src])').allTextContents()
  expect(inlineScriptBodies.every((body) => body.includes('injectIntoGlobalHook'))).toBeTruthy()
})
