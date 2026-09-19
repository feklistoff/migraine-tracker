import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './App'
import { parseRoute, routeHref } from './Router'

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  window.location.hash = ''
})

describe('app navigation', () => {
  it('preserves a selected History day when a pushed page is opened', () => {
    const route = parseRoute('#history?day=2024-09-18')

    expect(route).toEqual({ kind: 'tab', tab: 'history', selectedDay: '2024-09-18' })
    expect(routeHref({ kind: 'page', page: 'timeline', tab: 'history', selectedDay: '2024-09-18' })).toBe(
      '#timeline?day=2024-09-18',
    )
  })

  it('switches between tabs without losing the shared shell', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('link', { name: 'History' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument())
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('link', { name: 'Statistics' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Statistics' })).toBeInTheDocument())
    expect(window.location.hash).toBe('#statistics')
  })

  it('keeps pushed pages in the tab shell and hides tabs for entry forms', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument())
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Back to Today' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Start a headache' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('link', { name: 'Start a headache' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'New headache' })).toBeInTheDocument())
    expect(screen.queryByRole('navigation', { name: 'Sections' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Today' })).toBeInTheDocument()
  })
})
