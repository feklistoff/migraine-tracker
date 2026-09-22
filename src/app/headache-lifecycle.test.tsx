import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { saveReading, saveRetrospectiveEpisode, startEpisode } from '../data/commands'
import { deleteDiaryDatabase } from '../data/db'
import { DiaryRepository } from '../data/repository'
import { fixedClock } from '../domain/time'
import { fixtureEventTime } from '../test/fixtures'

const databaseName = 'headache-diary-lifecycle-tests'
const clock = fixedClock('2024-09-18T14:05:00Z', 'Europe/Helsinki')
const activeRepositories = new Set<DiaryRepository>()

afterEach(async () => {
  window.history.replaceState({}, '', '/')
  window.location.hash = ''
  for (const repository of activeRepositories) await repository.close()
  activeRepositories.clear()
  await deleteDiaryDatabase(databaseName)
})

async function renderDiary(options: ConstructorParameters<typeof DiaryRepository>[0] = {}) {
  const repository = new DiaryRepository({ databaseName, clock, ...options })
  activeRepositories.add(repository)
  render(<App repository={repository} />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Nothing recorded yet.' })).toBeInTheDocument())
  return repository
}

describe('headache lifecycle', () => {
  it('persists the onset before opening an incomplete form with no invented details', async () => {
    const repository = await renderDiary()

    fireEvent.click(screen.getByRole('link', { name: 'Start a headache' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'New headache' })).toBeInTheDocument())
    expect((await repository.read()).episodes).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Pain 0 of 10' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Normal activities' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Words' }))
    expect((await repository.read()).settings.painEntryDefault).toBe('numeric')

    fireEvent.click(screen.getByRole('link', { name: 'Back to Today' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 3, name: 'No medicine recorded yet.' })).toBeInTheDocument()
    expect((await repository.read()).episodes[0]?.state).toBe('ongoing')
  })

  it('saves optional start details into one onset reading and can finish and undo it', async () => {
    const repository = await renderDiary()

    fireEvent.click(screen.getByRole('link', { name: 'Start a headache' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'New headache' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Pain 6 of 10' }))
    fireEvent.click(screen.getByRole('button', { name: 'Slowed down' }))
    fireEvent.change(screen.getByLabelText('Optional note'), { target: { value: 'Needed a quiet room.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save headache' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toBeInTheDocument())
    let facts = await repository.read()
    expect(facts.episodes).toHaveLength(1)
    expect(facts.episodes[0]?.note).toBe('Needed a quiet room.')
    expect(facts.readings).toHaveLength(1)
    expect(facts.readings[0]).toMatchObject({ atOnset: true, pain: { kind: 'numeric', value: 6 }, impact: 'slowed' })

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('link', { name: 'Edit start' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'New headache' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: '2024-09-18T16:05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save headache' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toBeInTheDocument())
    facts = await repository.read()
    expect(facts.readings[0]?.measuredAt.instant).toBe(facts.episodes[0]?.start.instant)

    fireEvent.click(screen.getByRole('button', { name: 'End headache now' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Glad it’s over.' })).toBeInTheDocument())
    facts = await repository.read()
    expect(facts.episodes[0]?.state).toBe('ended')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toBeInTheDocument())
    expect((await repository.read()).episodes[0]?.state).toBe('ongoing')
  })

  it('keeps the form draft and onset when an optional-detail write fails', async () => {
    let failReadingWrite = false
    const repository = await renderDiary({
      writeFault: ({ operation, step }) => {
        if (failReadingWrite && operation === 'save-reading' && step === 'before-revision') {
          throw new Error('simulated reading write failure')
        }
      },
    })

    fireEvent.click(screen.getByRole('link', { name: 'Start a headache' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'New headache' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Pain 4 of 10' }))
    failReadingWrite = true
    fireEvent.click(screen.getByRole('button', { name: 'Save headache' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('simulated reading write failure'))
    expect(screen.getByRole('button', { name: 'Pain 4 of 10' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { level: 1, name: 'New headache' })).toBeInTheDocument()
    const facts = await repository.read()
    expect(facts.episodes).toHaveLength(1)
    expect(facts.readings).toHaveLength(0)
  })

  it('preserves a note-only onset reading when Start is saved unchanged', async () => {
    const repository = await renderDiary()
    const episode = await startEpisode(repository, {
      id: 'episode-note-only-onset',
      start: fixtureEventTime('2024-09-18T16:00'),
      note: null,
    })
    await saveReading(repository, {
      id: 'reading-note-only-onset',
      episodeId: episode.id,
      measuredAt: episode.start,
      pain: null,
      impact: null,
      note: 'Aura began before the pain.',
      linkedDoseId: null,
      atOnset: true,
    })

    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('link', { name: 'Edit start' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'New headache' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Save headache' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toBeInTheDocument())
    expect((await repository.read()).readings).toEqual([
      expect.objectContaining({ id: 'reading-note-only-onset', note: 'Aura began before the pain.' }),
    ])
  })

  it('clears an incompatible pain value when the Start pain mode changes', async () => {
    const repository = await renderDiary()
    fireEvent.click(screen.getByRole('link', { name: 'Start a headache' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'New headache' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Pain 4 of 10' }))
    fireEvent.click(screen.getByRole('button', { name: 'Words' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save headache' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Headache ongoing' })).toBeInTheDocument())
    expect((await repository.read()).readings).toEqual([])
  })

  it('opens ended headache details in the retrospective editor', async () => {
    const repository = await renderDiary()
    await saveRetrospectiveEpisode(repository, {
      id: 'episode-ended-details',
      start: fixtureEventTime('2024-09-18T12:00'),
      end: fixtureEventTime('2024-09-18T13:00'),
      note: null,
      doses: [],
    })

    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Headache ended' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('link', { name: 'Edit details' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Edit headache' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Pain 4 of 10' }))
    fireEvent.click(screen.getByRole('button', { name: 'Words' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Timeline' })).toBeInTheDocument())
    expect((await repository.read()).readings).toEqual([])
  })

  it('dismisses the forgotten-end cue without changing the episode', async () => {
    const repository = await renderDiary()
    await startEpisode(repository, {
      id: 'episode-forgotten-end',
      start: fixtureEventTime('2024-09-17T12:00'),
      note: null,
    })

    await waitFor(() => expect(screen.getByText('Still recording this headache?')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Still recording this headache?')).not.toBeInTheDocument()
    expect((await repository.read()).episodes[0]).toMatchObject({ id: 'episode-forgotten-end', state: 'ongoing' })
  })

  it('initialises the end editor in the episode time zone', async () => {
    const repository = await renderDiary({ clock: fixedClock('2024-09-18T14:05:00Z', 'America/New_York') })
    await startEpisode(repository, {
      id: 'episode-helsinki-time',
      start: fixtureEventTime('2024-09-17T12:00'),
      note: null,
    })

    await waitFor(() => expect(screen.getByText('Still recording this headache?')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Edit the end time' }))
    expect(screen.getByLabelText('Date and time')).toHaveValue('2024-09-18T17:05')
  })
})
