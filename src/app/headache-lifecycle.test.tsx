import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { deleteDiaryDatabase } from '../data/db'
import { DiaryRepository } from '../data/repository'
import { fixedClock } from '../domain/time'

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
})
