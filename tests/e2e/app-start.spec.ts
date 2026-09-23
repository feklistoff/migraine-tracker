import { expect, test } from '@playwright/test'

test('app starts with an empty diary shell', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1, name: 'Headache diary' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeVisible()
})
