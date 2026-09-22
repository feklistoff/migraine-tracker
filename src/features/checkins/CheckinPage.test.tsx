import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deleteDiaryDatabase } from '../../data/db'
import { DiaryRepository } from '../../data/repository'
import { fixedClock } from '../../domain/time'
import { App } from '../../app/App'

const databaseName = 'headache-diary-checkin-tests'
const clock = fixedClock('2024-09-18T14:05:00Z', 'Europe/Helsinki')
let repository: DiaryRepository

beforeEach(() => {
  repository = new DiaryRepository({ databaseName, clock })
})

afterEach(async () => {
  await repository.close()
  await deleteDiaryDatabase(databaseName)
  window.history.replaceState({}, '', '/')
  window.location.hash = ''
})

async function renderDiary() {
  render(<App repository={repository} />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeInTheDocument())
}

describe('daily confirmation and day-before notes', () => {
  it('saves and undoes a timestamped no-headache confirmation', async () => {
    await renderDiary()

    fireEvent.click(screen.getByRole('button', { name: 'No headache so far' }))
    await waitFor(() => expect(screen.getByText('No headache so far today')).toBeInTheDocument())
    expect((await repository.read()).dailyRecords[0]).toMatchObject({
      day: '2024-09-18',
      headacheFreeAt: { instant: expect.any(String) },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'No headache so far' })).toBeInTheDocument())
    expect((await repository.read()).dailyRecords).toEqual([])
  })

  it('keeps nullable day-before answers and clears a choice when tapped again', async () => {
    await renderDiary()

    fireEvent.click(screen.getByRole('link', { name: /Yesterday & last night/ }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Yesterday & last night' })).toBeInTheDocument())
    const alcoholQuestion = screen.getByRole('heading', { name: 'Did you drink alcohol yesterday?' }).closest('section')
    const stressQuestion = screen.getByRole('heading', { name: 'Was yesterday stressful?' }).closest('section')
    fireEvent.click(within(alcoholQuestion!).getByRole('button', { name: 'Yes' }))
    fireEvent.click(within(alcoholQuestion!).getByRole('button', { name: 'Yes' }))
    fireEvent.click(screen.getByRole('button', { name: /Not enough/ }))
    fireEvent.click(within(stressQuestion!).getByRole('button', { name: 'No' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeInTheDocument())
    expect((await repository.read()).dailyRecords[0]).toMatchObject({
      day: '2024-09-18',
      headacheFreeAt: null,
      alcohol: null,
      sleep: 'not_enough',
      stress: false,
    })
  })

  it('hides day-before notes during an active headache and restores them after ending', async () => {
    await renderDiary()

    fireEvent.click(screen.getByRole('link', { name: 'Start a headache' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'New headache' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('link', { name: 'Back to Today' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toBeInTheDocument())
    expect(screen.queryAllByRole('link', { name: /Yesterday & last night/ })).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'End headache now' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Glad it’s over.' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /Yesterday & last night/ })).toBeInTheDocument()
  })

  it('keeps a backdated confirmation with its selected day and blocks future days', async () => {
    window.location.hash = '#checkin?day=2024-09-01'
    render(<App repository={repository} />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Yesterday & last night' })).toBeInTheDocument())
    expect(screen.getByText(/August 31/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'No headache' }))
    await waitFor(() => expect(screen.getByText(/No headache recorded for/)).toBeInTheDocument())
    expect((await repository.read()).dailyRecords[0]).toMatchObject({ day: '2024-09-01' })

    window.location.hash = '#checkin?day=2024-09-19'
    await waitFor(() => expect(screen.getByText('Future days cannot be recorded yet.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'No headache' })).toBeDisabled()
  })
})
