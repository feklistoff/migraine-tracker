import { expect, test } from '@playwright/test'

function rgbChannels(value: string): [number, number, number] {
  const hex = value.match(/^#([\da-f]{6})$/i)?.[1]
  if (hex) return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [number, number, number]
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3) throw new Error(`Unsupported CSS color: ${value}`)
  return channels as [number, number, number]
}

function luminance(color: string): number {
  const [red, green, blue] = rgbChannels(color).map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test.describe('Task 15 accessibility acceptance', () => {
  test('respects reduced-motion preferences for animated controls', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#settings')

    const switchKnob = page.locator('.settings-switch__knob')
    await expect(switchKnob).toBeVisible()
    await expect.poll(() => switchKnob.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s')
  })

  test('keeps the main Settings and History touch controls at least 44px tall', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/#settings')
    await page.getByRole('button', { name: 'Add a medicine' }).click()
    await page.getByLabel('Medicine name').fill('Synthetic accessibility fixture')
    await page.getByRole('textbox', { name: 'Dose' }).fill('1 tablet')
    await page.getByRole('button', { name: 'Save medicine' }).click()

    const settingsTargets = await page.locator('.settings-segmented button, .settings-row-action').evaluateAll((elements) =>
      elements.map((element) => ({
        name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
        height: Math.round(element.getBoundingClientRect().height),
      })),
    )
    expect(settingsTargets.filter((target) => target.height < 44)).toEqual([])

    await page.goto('/#history')
    await page.getByRole('button', { name: 'Show missing days' }).click()
    const historyTargets = await page.locator('.history-day, .history-missing__list button, .history-coverage .text-action').evaluateAll((elements) =>
      elements.map((element) => ({
        name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
        height: Math.round(element.getBoundingClientRect().height),
      })),
    )
    expect(historyTargets.filter((target) => target.height < 44)).toEqual([])
  })

  test('keeps keyboard focus visible and exposes the selected navigation and day', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('heading', { level: 1, name: 'Headache diary' }).click()
    await page.keyboard.press('Tab')

    const firstFocus = await page.evaluate(() => {
      const element = document.activeElement
      if (!(element instanceof HTMLElement)) return null
      return {
        label: element.getAttribute('aria-label') || element.textContent?.trim(),
        outlineWidth: Number.parseFloat(getComputedStyle(element).outlineWidth),
      }
    })
    expect(firstFocus?.label).toBe('Settings')
    expect(firstFocus?.outlineWidth).toBeGreaterThanOrEqual(2)

    await page.getByRole('link', { name: 'History' }).click()
    await expect(page.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.history-day[aria-pressed="true"]')).toHaveCount(1)
  })

  test('keeps the approved text and surface color pairs above 4.5:1 in light and dark', async ({ page }) => {
    const pairs = [
      ['--color-text', '--color-page'],
      ['--color-text', '--color-surface'],
      ['--color-muted', '--color-page'],
      ['--color-muted', '--color-surface'],
      ['--color-muted', '--color-accent-tint'],
      ['--color-accent-text', '--color-page'],
      ['--color-accent-text', '--color-surface'],
      ['--color-accent-text', '--color-accent-tint'],
      ['--color-on-accent', '--color-accent'],
      ['--color-accent-tint-text', '--color-accent-tint'],
      ['--color-sage-text', '--color-sage-tint'],
      ['--color-undo-text', '--color-undo-background'],
      ['--color-undo-action', '--color-undo-background'],
    ] as const

    await page.goto('/')
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      const values = await page.evaluate((keys) => {
        const style = getComputedStyle(document.documentElement)
        return keys.map(([foreground, background]) => ({
          pair: `${foreground} on ${background}`,
          foreground: style.getPropertyValue(foreground).trim(),
          background: style.getPropertyValue(background).trim(),
        }))
      }, pairs)
      const failures = values.map((pair) => ({ ...pair, ratio: contrastRatio(pair.foreground, pair.background) })).filter((pair) => pair.ratio < 4.5)
      expect(failures, `${scheme} theme contrast failures`).toEqual([])
    }
  })

  test('avoids horizontal clipping at 320px with 200% root text sizing', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto('/#settings')
    await page.addStyleTag({ content: ':root { font-size: 200% !important; }' })

    const widths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      main: document.querySelector('.diary-main')?.scrollWidth ?? 0,
    }))
    expect(widths.document).toBeLessThanOrEqual(widths.viewport)
    expect(widths.main).toBeLessThanOrEqual(widths.viewport)
  })

  test('wraps long synthetic medicine labels and notes at a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto('/#settings')
    const medicineName = 'Synthetic long medicine label '.repeat(4).trim()
    await page.getByRole('button', { name: 'Add a medicine' }).click()
    await page.getByLabel('Medicine name').fill(medicineName)
    await page.getByRole('textbox', { name: 'Dose' }).fill('1 tablet with a long optional instruction for the synthetic fixture')
    await page.getByRole('button', { name: 'Save medicine' }).click()
    await expect(page.getByText(medicineName)).toBeVisible()

    await page.goto('/#past')
    await page.getByLabel('Started · date and time').fill('2024-09-16T12:00')
    await page.getByLabel('Ended · date and time').fill('2024-09-16T13:00')
    const note = 'Synthetic long timeline note for responsive wrapping. '.repeat(20).trim()
    await page.getByLabel('Optional note').fill(note)
    await page.getByRole('button', { name: 'Save headache' }).click()
    await expect(page.locator('.timeline-note')).toContainText(note)

    const widths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      note: document.querySelector('.timeline-note')?.scrollWidth ?? 0,
      noteClient: document.querySelector('.timeline-note')?.clientWidth ?? 0,
    }))
    expect(widths.document).toBeLessThanOrEqual(widths.viewport)
    expect(widths.note).toBeLessThanOrEqual(widths.noteClient)
  })
})
