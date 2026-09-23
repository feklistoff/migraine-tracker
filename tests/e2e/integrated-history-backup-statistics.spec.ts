import { expect, test } from '@playwright/test'

test('History backfill survives backup restore and agrees with Today and Statistics', async ({ page }) => {
  await page.clock.install({ time: new Date('2024-09-18T14:05:00+03:00') })
  await page.goto('/#history?day=2024-09-16&missing=1')
  await expect(page.getByRole('region', { name: 'Missing days' })).toBeVisible()
  await expect(page.getByText('No entry for this day')).toBeVisible()

  await page.getByRole('link', { name: 'Add a headache', exact: true }).click()
  await page.getByLabel('Started · date and time').fill('2024-09-16T12:00')
  await page.getByLabel('Ended · date and time').fill('2024-09-16T13:00')
  await page.getByRole('button', { name: 'Pain 5 of 10' }).click()
  await page.getByRole('button', { name: 'Save headache' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to History' }).click()
  await expect(page.getByText('Began on this day')).toBeVisible()

  await page.goto('/#settings')
  await page.getByRole('link', { name: /Make backup/ }).click()
  await expect(page.getByText('File ready')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download backup' }).click()
  const download = await downloadPromise
  const backupPath = await download.path()
  if (!backupPath) throw new Error('Backup download path is unavailable.')

  await page.getByRole('link', { name: 'Back to Settings' }).click()
  await page.getByRole('button', { name: 'Add a medicine' }).click()
  await page.getByLabel('Medicine name').fill('Temporary medicine')
  await page.getByRole('textbox', { name: 'Dose' }).fill('1 tablet')
  await page.getByRole('button', { name: 'Save medicine' }).click()
  await expect(page.getByText('Temporary medicine')).toBeVisible()

  await page.getByRole('link', { name: /Restore from backup/ }).click()
  await page.getByLabel('Choose backup file').setInputFiles(backupPath)
  await expect(page.getByText('Complete diary backup')).toBeVisible()
  await expect(page.getByText('medicine “Temporary medicine”')).toBeVisible()
  page.once('dialog', (dialog) => { void dialog.accept() })
  await page.getByRole('button', { name: 'Replace with this backup' }).click()
  await expect(page.getByRole('heading', { name: 'Diary restored' })).toBeVisible()

  await page.goto('/#history?day=2024-09-16')
  await expect(page.getByText('Began on this day')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Recording coverage' })).toContainText('1 of 17 days recorded')

  await page.goto('/#today')
  const todaySummary = page.getByRole('region', { name: 'This month' })
  await expect(todaySummary).toContainText('1 headache days')
  await expect(todaySummary).toContainText('1 of 17 days recorded')

  await page.goto('/#statistics')
  await expect(page.getByRole('heading', { name: /September 2024 so far/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Recording coverage' })).toContainText('1 of 17 days recorded')
  await expect(page.locator('.statistics-tile').first()).toContainText('1')
  await page.getByRole('link', { name: /with no entry/ }).click()
  await expect(page).toHaveURL(/#history\?missing=1/)
  await expect(page.getByRole('region', { name: 'Missing days' })).toBeVisible()
})
