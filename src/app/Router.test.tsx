import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deleteDiaryDatabase } from '../data/db'
import { DiaryRepository } from '../data/repository'
import { fixedClock } from '../domain/time'
import { App } from './App'
import { parseRoute, routeHref } from './Router'

const databaseName = 'headache-diary-router-tests'
let repository: DiaryRepository

beforeEach(() => {
  repository = new DiaryRepository({ databaseName, clock: fixedClock('2024-09-18T14:05:00Z', 'Europe/Helsinki') })
})

afterEach(async () => {
  await repository.close()
  await deleteDiaryDatabase(databaseName)
  window.history.replaceState({}, '', '/')
  window.location.hash = ''
})

describe('app navigation', () => {
  it('preserves a selected History day when a pushed page is opened', () => {
    const route = { kind: 'page' as const, page: 'timeline' as const, tab: 'history' as const, selectedDay: '2024-09-18' }

    expect(routeHref(route)).toBe('#timeline?tab=history&day=2024-09-18')
    expect(parseRoute(routeHref(route))).toEqual(route)
  })

  it('deep-links to a month’s missing-days view', () => {
    const route = { kind: 'tab' as const, tab: 'history' as const, selectedDay: '2024-09-05', missing: true }
    expect(routeHref(route)).toBe('#history?day=2024-09-05&missing=1')
    expect(parseRoute(routeHref(route))).toEqual(route)
    expect(parseRoute('#history?missing=1')).toEqual({ kind: 'tab', tab: 'history', missing: true })
  })

  it('switches between tabs without losing the shared shell', async () => {
    render(<App repository={repository} />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'History' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('link', { name: 'History' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'September 2024' })).toBeInTheDocument())
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('link', { name: 'Statistics' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /September 2024.*so far/ })).toBeInTheDocument())
    expect(window.location.hash).toBe('#statistics')
  })

  it('keeps pushed pages in the tab shell and hides tabs for entry forms', async () => {
    render(<App repository={repository} />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument())

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
