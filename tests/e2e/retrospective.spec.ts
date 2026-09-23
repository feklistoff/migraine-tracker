import { expect, test, type Page } from '@playwright/test'

interface PastDose {
  medicine: string
  dose: string
  time: string
}

async function createPastEpisode(
  page: Page,
  options: { start: string; end: string; pain?: string; note?: string; dose?: PastDose },
) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Log a past headache' }).click()
  await page.getByLabel('Started · date and time').fill(options.start)
  await page.getByLabel('Ended · date and time').fill(options.end)
  if (options.pain) await page.getByRole('button', { name: options.pain }).click()
  if (options.note) await page.getByLabel('Optional note').fill(options.note)
  if (options.dose) {
    await page.getByRole('button', { name: 'Add a dose' }).click()
    await page.getByLabel('Medicine name for dose 1').fill(options.dose.medicine)
    await page.getByLabel('Dose for dose 1').fill(options.dose.dose)
    await page.getByLabel('Dose time 1').fill(options.dose.time)
    const followUp = page.getByRole('checkbox', { name: 'Follow-up check for dose 1' })
    if (!(await followUp.isChecked())) await followUp.check()
  }
  await page.getByRole('button', { name: 'Save headache' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
}

async function returnToTimeline(page: Page) {
  await page.getByRole('link', { name: 'View headache timeline' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
}

function localDateTimeMinutesAgo(minutesAgo: number): string {
  const value = new Date(Date.now() - minutesAgo * 60_000)
  const twoDigits = (number: number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${twoDigits(value.getMonth() + 1)}-${twoDigits(value.getDate())}T${twoDigits(value.getHours())}:${twoDigits(value.getMinutes())}`
}

test.describe('retrospective headache logging', () => {
  test('commits a multi-day headache, onset reading and two staged doses together', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Log a past headache' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Past headache' })).toBeVisible()
    await page.getByLabel('Started · date and time').fill('2024-09-16T22:30')
    await page.getByLabel('Ended · date and time').fill('2024-09-17T02:30')
    await page.getByRole('button', { name: 'Pain 7 of 10' }).click()
    await page.getByRole('button', { name: 'Had to stop' }).click()
    await page.getByLabel('Optional note').fill('Had to leave work early.')

    await page.getByRole('button', { name: 'Add a dose' }).click()
    await page.getByLabel('Medicine name for dose 1').fill('Ibuprofen')
    await page.getByLabel('Dose for dose 1').fill('400 mg')
    await page.getByLabel('Dose time 1').fill('2024-09-16T23:00')
    await page.getByRole('checkbox', { name: 'Save Ibuprofen to saved medicines' }).check()

    await page.getByRole('button', { name: 'Add a dose' }).click()
    await page.getByLabel('Medicine name for dose 2').fill('Paracetamol')
    await page.getByLabel('Dose for dose 2').fill('500 mg')
    await page.getByLabel('Dose time 2').fill('2024-09-17T01:00')
    await page.getByRole('button', { name: 'Save headache' }).click()

    await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
    await expect(page.getByText('2 doses')).toBeVisible()
    await expect(page.getByText('Ibuprofen · 400 mg')).toBeVisible()
    await expect(page.getByText('Paracetamol · 500 mg')).toBeVisible()
    await expect(page.getByText('7 of 10 · Had to stop')).toBeVisible()
  })

  test('canceling a staged entry leaves no saved headache or medicine', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Log a past headache' }).click()
    await page.getByLabel('Started · date and time').fill('2024-09-16T12:00')
    await page.getByLabel('Ended · date and time').fill('2024-09-16T13:00')
    await page.getByRole('button', { name: 'Add a dose' }).click()
    await page.getByLabel('Medicine name for dose 1').fill('Draft medicine')
    await page.once('dialog', (dialog) => { void dialog.accept() })
    await page.getByRole('link', { name: 'Back to Today' }).click()

    await expect(page.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeVisible()
    await expect(page.getByText('Draft medicine')).toHaveCount(0)
  })

  test('unknown-ended backfill stays out of the active headache state', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Log a past headache' }).click()
    await page.getByLabel('Started · date and time').fill('2024-09-18T12:00')
    await page.getByRole('switch', { name: 'I don’t know when it ended' }).check()
    await expect(page.getByText('Length unknown — left out of duration statistics.')).toBeVisible()
    await page.getByRole('button', { name: 'Save headache' }).click()

    await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
    await expect(page.getByText('Length unknown')).toBeVisible()
    await page.getByRole('link', { name: 'Back to Today' }).click()
    await expect(page.getByText('End time not recorded')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toHaveCount(0)

    await page.getByRole('link', { name: 'View headache timeline' }).click()
    await page.getByRole('link', { name: 'Add end time' }).click()
    await page.getByRole('switch', { name: 'I don’t know when it ended' }).uncheck()
    await page.getByLabel('Ended · date and time').fill('2024-09-18T14:00')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Headache ended', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Back to Today' }).click()
    await expect(page.getByText('End time not recorded')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toHaveCount(0)
  })

  test('timeline edits bounds and notes, adds and removes readings and doses', async ({ page }) => {
    await createPastEpisode(page, {
      start: '2024-09-16T22:00',
      end: '2024-09-17T03:00',
      pain: 'Pain 7 of 10',
      note: 'First note',
      dose: { medicine: 'Ibuprofen', dose: '400 mg', time: '2024-09-17T01:00' },
    })

    await page.getByRole('link', { name: 'Edit start' }).click()
    await page.getByLabel('Started · date and time').fill('2024-09-16T21:30')
    page.once('dialog', (dialog) => { void dialog.accept() })
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()

    const onsetEvent = page.locator('.timeline-event').filter({ hasText: 'At headache start' })
    await onsetEvent.getByRole('link', { name: 'Edit reading' }).click()
    await expect(page.getByLabel('Date and time')).toBeDisabled()
    await expect(page.getByLabel('Date and time')).toHaveValue('2024-09-16T21:30')
    await page.getByRole('link', { name: 'Back to Today' }).click()
    await returnToTimeline(page)

    await page.getByRole('link', { name: 'Edit end time' }).click()
    await page.getByLabel('Ended · date and time').fill('2024-09-17T00:30')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('alert')).toContainText('Edit the headache end time before recording a dose after it ended.')
    await page.getByLabel('Ended · date and time').fill('2024-09-17T02:30')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()

    await page.getByRole('link', { name: 'Edit note' }).click()
    await page.getByLabel('Optional note').fill('Updated after reviewing the diary.')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Updated after reviewing the diary.')).toBeVisible()

    await page.getByRole('link', { name: 'Add a reading' }).click()
    await page.getByLabel('Date and time').fill('2024-09-17T01:15')
    await page.getByRole('button', { name: 'Words' }).click()
    await page.getByRole('button', { name: 'Moderate, 4 to 6' }).click()
    await page.getByRole('button', { name: 'Slowed down' }).click()
    await page.getByRole('textbox', { name: 'Add a note (optional)' }).fill('Light-sensitive after a short rest.')
    await page.getByRole('button', { name: 'Save update' }).click()
    await returnToTimeline(page)
    await expect(page.getByText('No follow-up recorded.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Record late follow-up' })).toBeVisible()

    const readingEvent = page.locator('.timeline-event').filter({ hasText: 'Light-sensitive after a short rest.' })
    await readingEvent.getByRole('link', { name: 'Edit reading' }).click()
    await page.getByRole('button', { name: 'Mild, 1 to 3' }).click()
    await page.getByRole('button', { name: 'Save update' }).click()
    await returnToTimeline(page)
    await expect(page.getByText('Mild · Slowed down · Light-sensitive after a short rest.')).toBeVisible()

    const editedReadingEvent = page.locator('.timeline-event').filter({ hasText: 'Light-sensitive after a short rest.' })
    await editedReadingEvent.getByRole('link', { name: 'Edit reading' }).click()
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Delete this pain and activity reading?')
      await dialog.accept()
    })
    await page.getByRole('button', { name: 'Delete reading' }).click()
    await returnToTimeline(page)
    await expect(page.getByText('Light-sensitive after a short rest.')).toHaveCount(0)
    await expect(page.getByText('At headache start')).toBeVisible()

    await page.getByRole('link', { name: 'Add a dose' }).click()
    await expect(page.locator('.baseline-card')).toContainText('7 of 10')
    await expect(page.locator('.baseline-card')).toContainText('ago.')
    await page.getByLabel('Medicine name').fill('Paracetamol')
    await page.getByLabel('Dose', { exact: true }).fill('500 mg')
    await page.getByLabel('Date and time').fill('2024-09-17T02:00')
    await page.getByRole('button', { name: 'Log dose' }).click()
    await returnToTimeline(page)
    await expect(page.getByText('Paracetamol · 500 mg')).toBeVisible()

    const doseEvent = page.locator('.timeline-event').filter({ hasText: 'Paracetamol · 500 mg' })
    await doseEvent.getByRole('link', { name: 'Edit dose' }).click()
    await page.getByLabel('Dose', { exact: true }).fill('1,000 mg')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await returnToTimeline(page)
    await expect(page.getByText('Paracetamol · 1,000 mg')).toBeVisible()
  })

  test('expired dose checks accept late responses and reopen after deleting one', async ({ page }) => {
    await createPastEpisode(page, {
      start: '2024-09-18T12:00',
      end: '2024-09-18T14:00',
      dose: { medicine: 'Naproxen', dose: '250 mg', time: '2024-09-18T12:30' },
    })

    await page.getByRole('link', { name: 'Record late follow-up' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Follow-up check' })).toBeVisible()
    await page.getByLabel('Date and time').fill('2024-09-18T12:00')
    await page.getByRole('button', { name: 'Words' }).click()
    await page.getByRole('button', { name: 'No pain, 0' }).click()
    await page.getByRole('textbox', { name: 'Add a note (optional)' }).fill('Entered after the check window.')
    await page.getByRole('button', { name: 'Save follow-up' }).click()
    await expect(page.getByRole('alert')).toContainText('A follow-up cannot be before the dose was taken.')
    await page.getByLabel('Date and time').fill('2024-09-18T15:20')
    await expect(page.getByText(/after dose/)).toBeVisible()
    await page.getByRole('button', { name: 'Save follow-up' }).click()
    await returnToTimeline(page)
    await expect(page.getByText('Follow-up response')).toBeVisible()
    const responseEvent = page.locator('.timeline-event').filter({ hasText: 'Entered after the check window.' })
    await expect(responseEvent.getByText('No pain · Entered after the check window.')).toBeVisible()
    await expect(responseEvent.locator('time')).toContainText('3:20')

    await responseEvent.getByRole('link', { name: 'Edit follow-up' }).click()
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Delete this follow-up response?')
      await dialog.accept()
    })
    await page.getByRole('button', { name: 'Delete follow-up response' }).click()
    await returnToTimeline(page)
    await expect(page.getByText('No follow-up recorded.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Record late follow-up' })).toBeVisible()
  })

  test('an older dose backfill leaves the latest dose follow-up active', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Log a past headache' }).click()
    await page.getByLabel('Started · date and time').fill(localDateTimeMinutesAgo(360))
    await page.getByLabel('Ended · date and time').fill(localDateTimeMinutesAgo(30))
    await page.getByRole('button', { name: 'Add a dose' }).click()
    await page.getByLabel('Medicine name for dose 1').fill('Ibuprofen')
    await page.getByLabel('Dose for dose 1').fill('400 mg')
    await page.getByLabel('Dose time 1').fill(localDateTimeMinutesAgo(180))
    await page.getByRole('button', { name: 'Add a dose' }).click()
    await page.getByLabel('Medicine name for dose 2').fill('Naproxen')
    await page.getByLabel('Dose for dose 2').fill('250 mg')
    await page.getByLabel('Dose time 2').fill(localDateTimeMinutesAgo(120))
    await page.getByRole('button', { name: 'Save headache' }).click()
    await expect(page.getByText('Follow-up overdue.')).toBeVisible()
    await expect(page.getByText('This pending check was replaced by a later dose.')).toBeVisible()

    await page.getByRole('link', { name: 'Add a dose' }).click()
    await page.getByLabel('Medicine name').fill('Aspirin')
    await page.getByLabel('Dose', { exact: true }).fill('81 mg')
    await page.getByLabel('Date and time').fill(localDateTimeMinutesAgo(240))
    await expect(page.getByText('This earlier dose won’t replace the check for Naproxen · 250 mg.')).toBeVisible()
    await page.getByRole('button', { name: 'Log dose' }).click()
    await returnToTimeline(page)
    await expect(page.getByText('3 doses')).toBeVisible()
    await expect(page.getByText('This pending check was replaced by a later dose.')).toHaveCount(2)
    await expect(page.getByText('Follow-up overdue.')).toBeVisible()
  })

  test('disabled follow-ups and missing baselines stay explicit when adding a dose', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Settings' }).click()
    const followUpSetting = page.getByRole('switch', { name: 'Check how a dose worked' })
    if (await followUpSetting.getAttribute('aria-checked') === 'true') await followUpSetting.click()
    await expect(followUpSetting).toHaveAttribute('aria-checked', 'false')

    await createPastEpisode(page, {
      start: '2024-09-20T10:00',
      end: '2024-09-20T11:00',
    })
    await page.getByRole('link', { name: 'Add a dose' }).click()
    await expect(page.getByText('No pain reading recorded.')).toBeVisible()
    await expect(page.getByText('A dose will not fill in a pain score for you.')).toBeVisible()
    await expect(page.getByText('No follow-up check for this dose')).toBeVisible()
    await page.getByLabel('Medicine name').fill('One-off medicine')
    await page.getByLabel('Dose', { exact: true }).fill('1 tablet')
    await page.getByLabel('Date and time').fill('2024-09-20T10:30')
    await page.getByRole('button', { name: 'Update first' }).click()
    await expect(page.locator('#reading-date-time')).toHaveValue('2024-09-20T10:30')
    await page.getByRole('button', { name: 'Pain 4 of 10' }).click()
    await page.getByRole('button', { name: 'Save update' }).click()
    await expect(page.locator('#dose-medicine-name')).toHaveValue('One-off medicine')
    await expect(page.locator('#dose-text')).toHaveValue('1 tablet')
    await expect(page.locator('#dose-date-time')).toHaveValue('2024-09-20T10:30')
    await expect(page.locator('.baseline-card')).toContainText('4 of 10')
    await page.getByRole('button', { name: 'Log dose' }).click()
    await returnToTimeline(page)
    await expect(page.getByText('1 dose')).toBeVisible()
    await expect(page.getByText('No follow-up recorded.')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Record late follow-up' })).toHaveCount(0)
  })

  test('Today and timeline refresh follow-up status when the app resumes', async ({ page }) => {
    await page.clock.install({ time: new Date() })
    await page.goto('/')
    await page.getByRole('link', { name: 'Log a past headache' }).click()
    await page.getByLabel('Started · date and time').fill(localDateTimeMinutesAgo(180))
    await page.getByLabel('Ended · date and time').fill(localDateTimeMinutesAgo(10))
    await page.getByRole('button', { name: 'Add a dose' }).click()
    await page.getByLabel('Medicine name for dose 1').fill('Migraine medicine')
    await page.getByLabel('Dose for dose 1').fill('1 tablet')
    await page.getByLabel('Dose time 1').fill(localDateTimeMinutesAgo(150))
    await page.getByRole('button', { name: 'Save headache' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
    await expect(page.getByText('Follow-up overdue.')).toBeVisible()

    await page.clock.setFixedTime(new Date(Date.now() + 26 * 60 * 60 * 1000))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('link', { name: 'Record late follow-up' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to Today' }).click()
    await expect(page.getByRole('region', { name: 'overdue follow-up' })).toHaveCount(0)
  })

  test('headache deletion is confirmed and removes the timeline from Today', async ({ page }) => {
    await createPastEpisode(page, {
      start: '2024-09-19T10:00',
      end: '2024-09-19T11:00',
      pain: 'Pain 6 of 10',
      dose: { medicine: 'Acetaminophen', dose: '500 mg', time: '2024-09-19T10:30' },
    })

    page.once('dialog', (dialog) => { void dialog.dismiss() })
    await page.getByRole('button', { name: 'Delete this headache' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Delete this headache and all its readings and doses?')
      await dialog.accept()
    })
    await page.getByRole('button', { name: 'Delete this headache' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'View headache timeline' })).toHaveCount(0)
  })

  test('history date context survives retrospective save and return navigation', async ({ page }) => {
    await page.goto('/#past?tab=history&day=2024-09-18')
    await page.getByLabel('Started · date and time').fill('2024-09-16T10:00')
    await page.getByLabel('Ended · date and time').fill('2024-09-16T11:00')
    await page.getByRole('button', { name: 'Save headache' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
    await expect(page).toHaveURL(/#timeline\?tab=history&day=2024-09-18/)
    await page.getByRole('link', { name: 'Back to History' }).click()
    await expect(page).toHaveURL(/#history\?day=2024-09-18/)
  })
})
