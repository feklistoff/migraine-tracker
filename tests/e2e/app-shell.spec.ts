import { expect, test } from '@playwright/test'

test.describe('responsive app shell', () => {
  test('keeps the shell within narrow viewports and loads bundled fonts', async ({ page }) => {
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/')

      await expect(page.getByRole('heading', { level: 1, name: 'Headache diary' })).toBeVisible()
      await expect(page.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Log a current headache' })).toBeVisible()

      const layout = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }))
      const fonts = await page.evaluate(async () => {
        const [figtree, fraunces] = await Promise.all([
          document.fonts.load('400 16px "Figtree Variable"'),
          document.fonts.load('500 24px "Fraunces Variable"'),
        ])
        return { figtree: figtree.length, fraunces: fraunces.length }
      })

      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
      expect(fonts.figtree).toBeGreaterThan(0)
      expect(fonts.fraunces).toBeGreaterThan(0)
    }
  })

  test('uses dark tokens and hides the tab bar for entry shells', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 } })
    const page = await context.newPage()

    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()

    const colors = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      shell: getComputedStyle(document.querySelector('.diary-shell')!).backgroundColor,
    }))
    expect(colors.body).toBe('rgb(28, 25, 22)')
    expect(colors.shell).toBe('rgb(28, 25, 22)')

    await page.getByRole('link', { name: 'Log a current headache' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'New headache' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save headache' })).toBeEnabled()

    await context.close()
  })

  test('keeps long forms and their footer reachable at a narrow, enlarged-text viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/#past')
    await page.addStyleTag({ content: ':root { font-size: 200%; }' })
    await page.getByRole('button', { name: 'Add a dose' }).click()
    const widths = await page.locator('.diary-main').evaluate((main) => ({ client: main.clientWidth, scroll: main.scrollWidth }))
    expect(widths.scroll).toBeLessThanOrEqual(widths.client)
    await page.getByLabel('Optional note').scrollIntoViewIfNeeded()
    await expect(page.getByLabel('Optional note')).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Save headache' })).toBeInViewport({ ratio: 1 })
    await page.setViewportSize({ width: 390, height: 260 })
    await expect(page.getByRole('button', { name: 'Save headache' })).toBeInViewport({ ratio: 1 })
  })
})
