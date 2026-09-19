import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteDiaryDatabase } from './db'
import {
  deleteEpisode,
  editEpisode,
  finishEpisode,
  saveDailyRecord,
  saveDose,
  saveReading,
  startEpisode,
  undoEpisodeEnd,
} from './commands'
import { DiaryRepository, type RepositorySnapshot } from './repository'
import { fixedClock, nowEventTime } from '../domain/time'
import { fixtureEventTime } from '../test/fixtures'
import type { Episode, Reading } from '../domain/types'

const databaseName = 'headache-diary-persistence-tests'
const clock = fixedClock('2024-09-18T14:05:00Z', 'Europe/Helsinki')
const repositories = new Set<DiaryRepository>()

function createRepository(options: ConstructorParameters<typeof DiaryRepository>[0] = {}) {
  const repository = new DiaryRepository({ databaseName, clock, ...options })
  repositories.add(repository)
  return repository
}

async function start(repository: DiaryRepository, id = 'episode-1'): Promise<Episode> {
  return startEpisode(repository, {
    id,
    start: nowEventTime(clock),
    note: null,
  })
}

describe('transactional diary persistence', () => {
  beforeEach(async () => {
    for (const repository of repositories) await repository.close()
    repositories.clear()
    await deleteDiaryDatabase(databaseName)
  })

  afterEach(async () => {
    for (const repository of repositories) await repository.close()
    repositories.clear()
    vi.restoreAllMocks()
  })

  it('opens an empty, versioned database without seeding diary records', async () => {
    const repository = createRepository()

    const facts = await repository.open()

    expect(facts.metadata.schemaVersion).toBe(1)
    expect(facts.metadata.revision).toBe(0)
    expect(facts.settings.defaultMedicineId).toBeNull()
    expect(facts.episodes).toEqual([])
    expect(facts.readings).toEqual([])
    expect(facts.doses).toEqual([])
    expect(facts.medicines).toEqual([])
    expect(facts.dailyRecords).toEqual([])

    await repository.close()
  })

  it('commits a start atomically and notifies subscribers with the next revision', async () => {
    const repository = createRepository()
    const snapshots: RepositorySnapshot[] = []
    const unsubscribe = repository.subscribe((snapshot) => snapshots.push(snapshot))

    await repository.open()
    const episode = await start(repository)

    expect(episode.state).toBe('ongoing')
    expect(repository.snapshot().facts?.episodes).toHaveLength(1)
    expect(repository.snapshot().facts?.metadata.revision).toBe(1)
    expect(snapshots.at(-1)?.status).toBe('ready')
    expect(snapshots.at(-1)?.facts?.metadata.revision).toBe(1)

    unsubscribe()
    await repository.close()
  })

  it('rejects a second ongoing start and leaves the first record untouched', async () => {
    const repository = createRepository()
    await repository.open()
    await start(repository, 'episode-first')

    await expect(start(repository, 'episode-second')).rejects.toMatchObject({
      code: 'validation-failed',
    })

    const facts = await repository.read()
    expect(facts.episodes.map(({ id }) => id)).toEqual(['episode-first'])
    expect(facts.metadata.revision).toBe(1)
  })

  it('uses the dataset revision as a duplicate-submit guard for concurrent writes', async () => {
    const repository = createRepository()
    await repository.open()

    const first = startEpisode(
      repository,
      { id: 'episode-first', start: nowEventTime(clock), note: null },
      { expectedRevision: 0 },
    )
    const second = startEpisode(
      repository,
      { id: 'episode-second', start: nowEventTime(clock), note: null },
      { expectedRevision: 0 },
    )
    const results = await Promise.allSettled([first, second])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { code: 'stale-revision' },
    })
    expect((await repository.read()).metadata.revision).toBe(1)
  })

  it('rolls back a logical write when a later transaction step fails', async () => {
    const repository = createRepository({
      writeFault: ({ operation, step }) => {
        if (operation === 'start-episode' && step === 'before-revision') {
          throw new Error('simulated commit failure')
        }
      },
    })
    await repository.open()

    await expect(start(repository)).rejects.toThrow('simulated commit failure')

    const reloaded = createRepository()
    const facts = await reloaded.open()
    expect(facts.episodes).toEqual([])
    expect(facts.metadata.revision).toBe(0)
  })

  it('rejects a stale edit from another repository without overwriting newer data', async () => {
    const first = createRepository()
    const second = createRepository()
    await first.open()
    await second.open()
    await start(first)

    await expect(
      editEpisode(
        second,
        'episode-1',
        { note: 'stale edit' },
        { expectedRevision: 0 },
      ),
    ).rejects.toMatchObject({ code: 'stale-revision', expectedRevision: 0, actualRevision: 1 })

    const facts = await first.read()
    expect(facts.episodes[0].note).toBeNull()
    expect(facts.metadata.revision).toBe(1)
  })

  it('finishes and undoes an episode through revision-guarded transactions', async () => {
    const repository = createRepository()
    await repository.open()
    await startEpisode(repository, {
      id: 'episode-1',
      start: fixtureEventTime('2024-09-18T12:00'),
      note: null,
    })

    const ended = await finishEpisode(repository, 'episode-1', fixtureEventTime('2024-09-18T14:00'), {
      expectedRevision: 1,
    })
    expect(ended.state).toBe('ended')
    expect(repository.snapshot().facts?.metadata.revision).toBe(2)

    const ongoing = await undoEpisodeEnd(repository, 'episode-1', { expectedRevision: 2 })
    expect(ongoing.state).toBe('ongoing')
    expect(ongoing.end).toBeNull()
    expect(repository.snapshot().facts?.metadata.revision).toBe(3)
  })

  it('does not let a stale undo overwrite a later episode edit', async () => {
    const repository = createRepository()
    await repository.open()
    await startEpisode(repository, {
      id: 'episode-1',
      start: fixtureEventTime('2024-09-18T12:00'),
      note: null,
    })
    await finishEpisode(repository, 'episode-1', fixtureEventTime('2024-09-18T14:00'), {
      expectedRevision: 1,
    })
    await editEpisode(repository, 'episode-1', { note: 'edited after ending' }, { expectedRevision: 2 })

    await expect(
      undoEpisodeEnd(repository, 'episode-1', { expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: 'stale-revision' })

    const facts = await repository.read()
    expect(facts.episodes[0].state).toBe('ended')
    expect(facts.episodes[0].note).toBe('edited after ending')
  })

  it('cascades episode children while preserving independent daily records', async () => {
    const repository = createRepository()
    await repository.open()
    const episode = await start(repository)
    const revisionAfterStart = repository.snapshot().facts?.metadata.revision

    const reading: Reading = {
      id: 'reading-1',
      episodeId: episode.id,
      measuredAt: nowEventTime(clock),
      pain: { kind: 'numeric', value: 4 },
      impact: null,
      note: null,
      linkedDoseId: null,
      atOnset: false,
      createdAt: clock.now().toString(),
      updatedAt: clock.now().toString(),
    }
    await saveReading(repository, reading, { expectedRevision: revisionAfterStart })
    await saveDose(
      repository,
      {
        id: 'dose-1',
        episodeId: episode.id,
        takenAt: nowEventTime(clock),
        savedMedicineId: null,
        medicineName: 'Custom medicine',
        doseText: '1 tablet',
        followUpEnabled: false,
        followUpIntervalMinutes: 120,
        createdAt: clock.now().toString(),
        updatedAt: clock.now().toString(),
      },
      { expectedRevision: repository.snapshot().facts?.metadata.revision },
    )
    await saveDailyRecord(
      repository,
      {
        day: '2024-09-17',
        headacheFreeAt: null,
        alcohol: false,
        sleep: 'fair_amount',
        stress: null,
        createdAt: clock.now().toString(),
        updatedAt: clock.now().toString(),
      },
      { expectedRevision: repository.snapshot().facts?.metadata.revision },
    )

    await deleteEpisode(repository, episode.id, { expectedRevision: repository.snapshot().facts?.metadata.revision })

    const facts = await repository.read()
    expect(facts.episodes).toEqual([])
    expect(facts.readings).toEqual([])
    expect(facts.doses).toEqual([])
    expect(facts.dailyRecords).toHaveLength(1)
  })

  it('clears a conflicting headache-free confirmation in the same transaction as a start', async () => {
    const repository = createRepository()
    await repository.open()
    await saveDailyRecord(repository, {
      day: '2024-09-18',
      headacheFreeAt: nowEventTime(clock),
      alcohol: null,
      sleep: null,
      stress: null,
    })

    await start(repository)

    const facts = await repository.read()
    expect(facts.dailyRecords).toEqual([])
  })

  it('exposes a recoverable error state when opening fails during migration', async () => {
    const repository = createRepository({
      onMigration: () => {
        throw new Error('migration failed')
      },
    })

    await expect(repository.open()).rejects.toThrow('migration failed')
    expect(repository.snapshot().status).toBe('error')
    expect(repository.snapshot().facts).toBeUndefined()
    expect(repository.snapshot().error?.message).toContain('migration failed')
  })

  it('exposes a recoverable error state when a read fails instead of returning an empty diary', async () => {
    const repository = createRepository({
      readFault: () => {
        throw new Error('read failed')
      },
    })

    await expect(repository.open()).rejects.toThrow('read failed')
    expect(repository.snapshot()).toMatchObject({ status: 'error', facts: undefined })
  })
})
