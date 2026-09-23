import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { emptyDiaryFixture, fixtureEventTime } from '../../test/fixtures'
import type { Episode } from '../../domain/types'
import { StatisticsPage } from './StatisticsPage'

const audit = { createdAt: '2024-09-18T10:00:00Z', updatedAt: '2024-09-18T10:00:00Z' }
const route = { kind: 'tab' as const, tab: 'statistics' as const }
const now = fixtureEventTime('2024-09-18T17:05')

describe('Statistics page', () => {
  it('shows shared current-month coverage, meaningful empty treatment state and month navigation', () => {
    const episode: Episode = {
      ...audit, id: 'one', start: fixtureEventTime('2024-09-03T10:00'),
      state: 'ended', end: fixtureEventTime('2024-09-03T12:00'), note: null,
    }
    render(<StatisticsPage route={route} facts={{ ...emptyDiaryFixture(), episodes: [episode] }} now={now} />)

    expect(screen.getByText('1 of 17 days recorded')).toBeInTheDocument()
    expect(screen.getAllByText('1', { selector: '.statistics-tile__value' })).toHaveLength(2)
    expect(screen.getByText('Not enough entries yet.', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('heading', { name: 'August 2024' })).toBeInTheDocument()
    expect(screen.getByText('0 of 31 days recorded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled()
  })

  it('renders a treatment row without inventing missing before or after pain', () => {
    const episode: Episode = {
      ...audit, id: 'treated', start: fixtureEventTime('2024-09-03T10:00'),
      state: 'ended', end: fixtureEventTime('2024-09-03T13:00'), note: null,
    }
    const facts = {
      ...emptyDiaryFixture(),
      episodes: [episode],
      doses: [{
        ...audit, id: 'dose', episodeId: episode.id, takenAt: fixtureEventTime('2024-09-03T11:00'),
        savedMedicineId: null, medicineName: 'Medicine', doseText: '1 tablet', followUpEnabled: true as const,
        followUpIntervalMinutes: 120 as const,
      }],
    }
    render(<StatisticsPage route={route} facts={facts} now={now} />)

    expect(screen.getByText('No pain recorded before this dose')).toBeInTheDocument()
    expect(screen.getByText('No linked follow-up recorded')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View headache timeline' })).toHaveAttribute('href', '#timeline?tab=statistics&episode=treated')
  })
})
