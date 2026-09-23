import { expect, test } from '@playwright/test'

test('downloads a complete file, previews replacement, honors cancel, and restores it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('link', { name: /Make backup/ }).click()
  await expect(page.getByText('File ready')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download backup' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^headache-diary-\d{4}-\d{2}-\d{2}\.json$/)
  const path = await download.path()
  if (!path) throw new Error('Backup download path is unavailable.')

  await page.getByRole('link', { name: 'Back to Settings' }).click()
  await page.getByRole('button', { name: 'Add a medicine' }).click()
  await page.getByLabel('Medicine name').fill('Example medicine')
  await page.getByRole('textbox', { name: 'Dose' }).fill('1 tablet')
  await page.getByRole('button', { name: 'Save medicine' }).click()
  await expect(page.getByText('Example medicine')).toBeVisible()

  await page.getByRole('link', { name: /Restore from backup/ }).click()
  await page.getByLabel('Choose backup file').setInputFiles(path)
  await expect(page.getByText('Complete diary backup')).toBeVisible()
  await expect(page.getByText('1 records would be removed', { exact: false })).toBeVisible()
  await expect(page.getByText('medicine “Example medicine”')).toBeVisible()

  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Replace with this backup' }).click()
  await expect(page.getByText('Complete diary backup')).toBeVisible()
  await expect(page.getByText('Example medicine', { exact: true })).toHaveCount(0)

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Replace with this backup' }).click()
  await expect(page.getByRole('heading', { name: 'Diary restored' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Settings' }).click()
  await expect(page.getByText('No saved medicines yet.')).toBeVisible()
})
