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
  const calendar = dialog.getByRole('group', { name: 'Calendar days' })
  const [year, month, day] = value.split(/[-T:]/).map(Number)
  const [shownYear, shownMonth] = (await calendar.getAttribute('data-month'))!.split('-').map(Number)
  const delta = (year! - shownYear!) * 12 + month! - shownMonth!
  for (let i = 0; i < Math.abs(delta); i++) {
    await dialog.getByRole('button', { name: delta < 0 ? 'Previous month' : 'Next month', exact: true }).click()
  }
  const dayLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)))
  await calendar.getByRole('button', { name: dayLabel, exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Time', exact: true }).fill(value.split('T')[1]!.slice(0, 5))
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}
