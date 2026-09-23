import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { App } from '../../app/App'
import { formatCivilDay } from '../../app/locale'
import { deleteDiaryDatabase } from '../../data/db'
import { DiaryRepository } from '../../data/repository'
import { fixedClock } from '../../domain/time'
import { emptyDiaryFixture, fixtureEventTime } from '../../test/fixtures'
import { HistoryPage } from './HistoryPage'

const databaseName = 'headache-diary-history-tests'
let repository: DiaryRepository

beforeEach(() => {
  repository = new DiaryRepository({ databaseName, clock: fixedClock('2024-09-18T11:05:00Z', 'Europe/Helsinki') })
  window.location.hash = '#history?day=2024-09-05'
})

afterEach(async () => {
  await repository.close()
  await deleteDiaryDatabase(databaseName)
  window.history.replaceState({}, '', '/')
})

describe('History', () => {
  it('[R-04.1] shows the locale calendar and a usable missing-days list', async () => {
    render(<App repository={repository} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'September 2024' })).toBeInTheDocument())
    expect(screen.getByText('0 of 17 days recorded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${formatCivilDay('2024-09-05')}, no entry` })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Show missing days' }))
    const missingList = await screen.findByRole('region', { name: 'Missing days' })
    expect(within(missingList).getByRole('button', { name: /September 5|5 September/ })).toBeInTheDocument()
    fireEvent.click(within(missingList).getByRole('button', { name: /September 4|4 September/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: formatCivilDay('2024-09-04') })).toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Missing days' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'No headache' }))
    await waitFor(() => expect(screen.getByText('1 of 17 days recorded')).toBeInTheDocument())
    expect(screen.getByText('You marked this day headache-free.')).toBeInTheDocument()
  })

  it('navigates across months and keeps future days view-only', async () => {
    render(<App repository={repository} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'September 2024' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'October 2024' })).toBeInTheDocument())
    expect(screen.getByText("This day hasn’t happened yet.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'No headache' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Add a headache/ })).not.toBeInTheDocument()
  })

  it('opens the missing-days view directly from a History URL', async () => {
    window.location.hash = '#history?day=2024-09-05&missing=1'
    render(<App repository={repository} />)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Missing days' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'September 2024' })).toBeInTheDocument()
  })

  it('opens a dated past-headache form and returns to the selected History date', async () => {
    render(<App repository={repository} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'September 2024' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('link', { name: 'Add a headache' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Past headache' })).toBeInTheDocument())
    expect(screen.getByText(`From History: ${formatCivilDay('2024-09-05')}. Choose the actual start and end times.`)).toBeInTheDocument()
    expect(screen.getByLabelText('Started · date and time')).toHaveValue('')
    fireEvent.click(screen.getByRole('link', { name: 'Back to History' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: formatCivilDay('2024-09-05') })).toBeInTheDocument())
  })

  it('shows multiple episodes touching a day and labels carried-in intervals', () => {
    const facts = emptyDiaryFixture()
    const audit = { createdAt: '2024-09-18T10:00:00Z', updatedAt: '2024-09-18T10:00:00Z' }
    facts.episodes = [
      { ...audit, id: 'carry', start: fixtureEventTime('2024-09-04T22:00'), state: 'ended', end: fixtureEventTime('2024-09-05T03:00'), note: 'Across midnight' },
      { ...audit, id: 'new', start: fixtureEventTime('2024-09-05T12:00'), state: 'ended', end: fixtureEventTime('2024-09-05T13:00'), note: null },
    ]
    render(<HistoryPage route={{ kind: 'tab', tab: 'history', selectedDay: '2024-09-05' }} facts={facts} repository={repository} />)
    expect(screen.getAllByText(/Headache ·/)).toHaveLength(2)
    expect(screen.getByText(`Continued from ${formatCivilDay('2024-09-04')}`)).toBeInTheDocument()
    expect(screen.getByText('Began on this day')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Open timeline for headache begun/ })[0]).toHaveAttribute('href', '#timeline?tab=history&day=2024-09-05&episode=carry')
  })
})
