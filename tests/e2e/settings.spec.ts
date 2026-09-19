import { expect, test } from '@playwright/test'

test('persists settings and manages saved medicines through reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await expect(page.getByText('No saved medicines yet.')).toBeVisible()
  await expect(page.getByText('App version')).toBeVisible()
  await expect(page.getByText('Build')).toBeVisible()

  await page.getByRole('button', { name: 'Words' }).click()
  await expect(page.getByRole('button', { name: 'Words' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '60 min' }).click()
  await expect(page.getByRole('button', { name: '60 min' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('switch', { name: 'Check how a dose worked' }).click()
  await expect(page.getByRole('switch', { name: 'Check how a dose worked' })).toHaveAttribute('aria-checked', 'false')

  await page.getByRole('button', { name: 'Add a medicine' }).click()
  await page.getByLabel('Medicine name').fill('Ibuprofen')
  await page.getByRole('textbox', { name: 'Dose' }).fill('400 mg')
  await page.getByRole('button', { name: 'Save medicine' }).click()
  await expect(page.getByText('Ibuprofen')).toBeVisible()

  await page.getByRole('button', { name: 'Make Ibuprofen the default' }).click()
  await expect(page.getByText('Default', { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Words' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('switch', { name: 'Check how a dose worked' })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('switch', { name: 'Check how a dose worked' }).click()
  await expect(page.getByRole('button', { name: '60 min' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Ibuprofen')).toBeVisible()

  await page.getByRole('button', { name: 'Archive Ibuprofen' }).click()
  await expect(page.getByRole('button', { name: 'Restore Ibuprofen' })).toBeVisible()
  await expect(page.getByText('No active medicines.')).toBeVisible()

  await page.getByRole('button', { name: 'Restore Ibuprofen' }).click()
  await expect(page.getByRole('button', { name: 'Make Ibuprofen the default' })).toBeVisible()
})
