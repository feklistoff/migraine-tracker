import { expect, test } from '@playwright/test'

test.describe('headache lifecycle', () => {
  test('keeps an onset through interruption, reload, finish and Undo', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeVisible()

    await page.getByRole('link', { name: 'Start a headache' }).dblclick()
    await expect(page.getByRole('heading', { level: 1, name: 'New headache' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pain 0 of 10' })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('button', { name: 'Normal activities' })).toHaveAttribute('aria-pressed', 'false')

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'New headache' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to Today' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toBeVisible()
    await expect(page.getByText('Not recorded').first()).toBeVisible()

    await page.getByRole('button', { name: 'End headache now' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Glad it’s over.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await page.getByRole('button', { name: 'Light' }).click()
    await page.getByRole('link', { name: 'Back to Today' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Glad it’s over.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Glad it’s over.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toBeVisible()
  })

  test('clears a pending Undo when another diary setting changes', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Start a headache' }).click()
    await page.getByRole('button', { name: 'Save headache' }).click()
    await page.getByRole('button', { name: 'End headache now' }).click()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()

    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Words' }).click()
    await page.getByRole('link', { name: 'Back to Today' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Glad it’s over.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
  })
})
