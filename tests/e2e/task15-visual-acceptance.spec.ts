import { readFileSync } from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

const fixedNow = new Date('2024-09-18T14:05:00+03:00')

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const controls = page.locator('button:visible, a[href]:visible, input:visible, textarea:visible, select:visible')
  for (let index = 0; index < await controls.count(); index += 1) {
    await expect(controls.nth(index), `${name}: visible control ${index} has an accessible name`).toHaveAccessibleName(/\S+/)
  }
  const main = page.locator('.diary-main')
  await main.evaluate((element) => { element.scrollTop = 0 })
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.scrollTo(0, 0)
  })
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(0)
  const pageHeader = page.locator('.entry-header, .app-header').first()
  if (name.startsWith('History')) {
    await expect(page.locator('.history-month-header')).toBeVisible()
  } else if (name.startsWith('Stats')) {
    await expect(page.locator('.statistics-month-header')).toBeVisible()
  } else {
    await expect(pageHeader).toHaveCount(1)
  }
  if (await pageHeader.count()) {
    const headerBox = await pageHeader.boundingBox()
    expect(headerBox?.y, `${name}: page header starts at the top of the screen`).toBeGreaterThanOrEqual(0)
    expect(headerBox?.y, `${name}: page header is not scrolled out of view`).toBeLessThanOrEqual(24)
  }
  const headerBack = page.locator('.entry-header .icon-button')
  if (await headerBack.count()) {
    await expect(headerBack).toBeVisible()
    const box = await headerBack.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true })
}

async function reviewTheme(page: Page, testInfo: TestInfo, scheme: 'light' | 'dark') {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install({ time: fixedNow })
  await page.emulateMedia({ colorScheme: scheme })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'Main' : 'Main-dark')

  await page.getByRole('link', { name: 'Start a headache' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'New headache' })).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'Start-empty' : 'Start-empty-dark')
  await page.locator('#start-date-time').fill('2024-09-18T10:00')
  await page.getByRole('button', { name: 'Pain 6 of 10' }).click()
  await page.getByRole('button', { name: 'Slowed down' }).click()
  await page.getByLabel('Optional note').fill('Synthetic onset note for visual review.')
  await capture(page, testInfo, scheme === 'light' ? 'Start' : 'Start-dark')
  await page.getByRole('button', { name: 'Save headache' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Headache diary' })).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'Active' : 'ActiveDark')

  await page.goto('/#settings')
  await page.getByRole('button', { name: 'Add a medicine' }).click()
  await page.getByLabel('Medicine name').fill('Synthetic medicine')
  await page.getByRole('textbox', { name: 'Dose' }).fill('400 mg')
  await page.getByRole('button', { name: 'Save medicine' }).click()
  await page.getByRole('button', { name: 'Make Synthetic medicine the default' }).click()
  const followUpSetting = page.getByRole('switch', { name: 'Check how a dose worked' })
  if (await followUpSetting.getAttribute('aria-checked') === 'false') await followUpSetting.click()
  await capture(page, testInfo, scheme === 'light' ? 'Settings' : 'Settings-dark')

  await page.goto('/#today')
  await page.getByRole('link', { name: 'Update pain' }).click()
  await page.getByRole('button', { name: 'Pain 4 of 10' }).click()
  await page.getByRole('button', { name: 'Had to stop' }).click()
  await page.getByRole('textbox', { name: 'Add a note (optional)' }).fill('Synthetic update note.')
  await capture(page, testInfo, scheme === 'light' ? 'Update' : 'Update-dark')
  await page.getByRole('button', { name: 'Save update' }).click()

  await page.getByRole('link', { name: 'Log dose' }).click()
  await page.getByLabel('Medicine name').fill('Synthetic medicine')
  await page.getByLabel('Dose', { exact: true }).fill('400 mg')
  await page.locator('#dose-date-time').fill('2024-09-18T12:00')
  await capture(page, testInfo, scheme === 'light' ? 'Dose' : 'Dose-dark')
  await page.getByRole('button', { name: 'Log dose' }).click()
  await expect(page.getByRole('region', { name: 'overdue follow-up' })).toBeVisible()

  await page.getByRole('link', { name: 'Record now' }).click()
  await page.getByRole('button', { name: 'Pain 2 of 10' }).click()
  await page.getByRole('button', { name: 'Normal activities' }).click()
  await page.getByRole('textbox', { name: 'Add a note (optional)' }).fill('Synthetic follow-up response.')
  await capture(page, testInfo, scheme === 'light' ? 'Follow-up' : 'Follow-up-dark')
  await page.getByRole('button', { name: 'Save follow-up' }).click()

  await page.getByRole('link', { name: 'View headache timeline' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'Timeline-ongoing' : 'Timeline-ongoing-dark')

  await page.goto('/#checkin?tab=today&day=2024-09-17')
  await expect(page.getByRole('heading', { level: 1, name: 'Yesterday & last night' })).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'Checkin' : 'Checkin-dark')

  await page.goto('/#today')
  await page.getByRole('button', { name: 'End headache now' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Glad it’s over.' })).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'Ended' : 'Ended-dark')

  await page.getByRole('link', { name: 'View headache timeline' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'Timeline' : 'Timeline-dark')
  await page.getByRole('link', { name: 'Back to Today' }).click()

  await page.goto('/#history?day=2024-09-18')
  await expect(page.getByRole('region', { name: 'Recording coverage' })).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'History' : 'History-dark')
  await page.getByRole('button', { name: 'Show missing days' }).click()
  await capture(page, testInfo, scheme === 'light' ? 'History-missing-days' : 'History-missing-days-dark')

  await page.goto('/#statistics')
  await expect(page.getByRole('region', { name: 'Recording coverage' })).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'Stats' : 'Stats-dark')

  await page.goto('/#today')
  await page.getByRole('link', { name: 'Log another past headache' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Past headache' })).toBeVisible()
  await page.getByLabel('Started · date and time').fill('2024-09-16T22:30')
  await page.getByLabel('Ended · date and time').fill('2024-09-16T23:30')
  await page.getByRole('button', { name: 'Pain 7 of 10' }).click()
  await page.getByRole('button', { name: 'Had to stop' }).click()
  await page.getByLabel('Optional note').fill('Synthetic past-headache note for visual review.')
  await capture(page, testInfo, scheme === 'light' ? 'Past' : 'Past-dark')

  await page.goto('/#backup')
  await expect(page.getByText('File ready')).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'Backup' : 'Backup-dark')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download backup' }).click()
  const download = await downloadPromise
  const backupPath = await download.path()
  if (!backupPath) throw new Error('Synthetic backup download path is unavailable.')

  await page.goto('/#settings')
  await page.getByRole('button', { name: 'Add a medicine' }).click()
  await page.getByLabel('Medicine name').fill('Synthetic restore difference')
  await page.getByRole('textbox', { name: 'Dose' }).fill('1 tablet')
  await page.getByRole('button', { name: 'Save medicine' }).click()
  await page.goto('/#restore')
  await page.getByLabel('Choose backup file').setInputFiles({
    name: 'headache-diary-2024-09-18.json',
    mimeType: 'application/json',
    buffer: readFileSync(backupPath),
  })
  await expect(page.getByText('Complete diary backup')).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'Restore' : 'Restore-dark')
  page.once('dialog', (dialog) => { void dialog.dismiss() })
  await page.getByRole('button', { name: 'Replace with this backup' }).click()
  await expect(page.getByText('Complete diary backup')).toBeVisible()
  page.once('dialog', (dialog) => { void dialog.accept() })
  await page.getByRole('button', { name: 'Replace with this backup' }).click()
  await expect(page.getByRole('heading', { name: 'Diary restored' })).toBeVisible()
  await capture(page, testInfo, scheme === 'light' ? 'Restore-complete' : 'Restore-complete-dark')
}

test.describe('Task 15 visual and screen reader acceptance', () => {
  test('captures deterministic synthetic-data reference screens in light mode', async ({ page }, testInfo) => {
    await reviewTheme(page, testInfo, 'light')
  })

  test('captures deterministic synthetic-data reference screens in dark mode', async ({ page }, testInfo) => {
    await reviewTheme(page, testInfo, 'dark')
  })
})
