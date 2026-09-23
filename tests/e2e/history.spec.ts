import { expect, test } from '@playwright/test'

test('History missing days can be reviewed and confirmed from a selected month', async ({ page }) => {
  await page.goto('/#history')
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeVisible()

  await page.getByRole('button', { name: 'Previous month' }).click()
  const initialCoverage = page.getByRole('region', { name: 'Recording coverage' })
  await expect(initialCoverage).toContainText(/0 of (28|29|30|31) days recorded/)

  await page.getByRole('button', { name: 'Show missing days' }).click()
  const list = page.getByRole('region', { name: 'Missing days' })
  await expect(list).toBeVisible()
  await list.getByRole('button').first().click()
  await expect(list).toBeHidden()
  await expect(page.getByText('No entry for this day')).toBeVisible()

  await page.getByRole('button', { name: 'No headache', exact: true }).click()
  await expect(initialCoverage).toContainText(/1 of (28|29|30|31) days recorded/)
  await expect(page.getByText('You marked this day headache-free.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('You marked this day headache-free.')).toBeVisible()
})

test('History calendar and selected day refresh after a past headache is added and deleted', async ({ page }) => {
  await page.goto('/#history?day=2024-09-16')
  await expect(page.getByText('No entry for this day')).toBeVisible()
  await page.getByRole('link', { name: 'Add a headache', exact: true }).click()
  await expect(page.getByText(/From History:/)).toBeVisible()
  await page.getByLabel('Started · date and time').fill('2024-09-16T12:00')
  await page.getByLabel('Ended · date and time').fill('2024-09-16T13:00')
  await page.getByRole('button', { name: 'Pain 5 of 10' }).click()
  await page.getByRole('button', { name: 'Save headache' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to History' }).click()

  await expect(page.getByText('Began on this day')).toBeVisible()
  await expect(page.getByRole('button', { name: /September 16, headache recorded/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('link', { name: /Open timeline for headache begun/ }).click()
  page.once('dialog', (dialog) => { void dialog.accept() })
  await page.getByRole('button', { name: 'Delete this headache' }).click()

  await expect(page.getByText('No entry for this day')).toBeVisible()
  await expect(page.getByRole('button', { name: /September 16, no entry/ })).toHaveAttribute('aria-pressed', 'true')
})
