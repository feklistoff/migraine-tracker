import { expect, type Page } from '@playwright/test'

export function eventTimeLabel(value: string) {
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number)
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!, hour, minute)))
}

export async function chooseEventTime(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).click()
  const dialog = page.getByRole('dialog', { name: label, exact: true })
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number)
  // Start with day 1 so changing month/year cannot constrain the desired day.
  for (const [field, next] of [['Day', 1], ['Year', year], ['Month', month], ['Day', day], ['Hour', hour], ['Minute', minute]] as const) {
    const wheel = dialog.getByRole('spinbutton', { name: field, exact: true })
    await wheel.locator(`[data-value="${next}"]`).click()
    await expect(wheel).toHaveAttribute('aria-valuenow', String(next))
  }
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}
