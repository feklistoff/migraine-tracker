import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deleteDiaryDatabase } from './db'
import { DIARY_STORE_SCHEMAS } from './migrations'
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
import { fixtureClock, fixtureEventTime } from '../test/fixtures'
import type { Episode, Reading } from '../domain/types'

const databaseName = 'headache-diary-persistence-tests'
const clock = fixtureClock
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
  })

  it('opens an empty, versioned database without seeding diary records', async () => {
    const repository = createRepository()

    const facts = await repository.open()

    expect(facts.metadata.schemaVersion).toBe(2)
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

    const snapshot = repository.snapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.error?.message).toContain('Only one headache can be ongoing')
    expect(snapshot.facts?.episodes.map(({ id }) => id)).toEqual(['episode-first'])
    expect(snapshot.facts?.metadata.revision).toBe(1)
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

  it('uses the cached revision as a guard when a command omits expectedRevision', async () => {
    const first = createRepository()
    const second = createRepository()
    await first.open()
    await second.open()
    await start(first)

    await expect(
      startEpisode(second, { id: 'episode-second', start: nowEventTime(clock), note: null }),
    ).rejects.toMatchObject({ code: 'stale-revision' })
  })

  it('[R-02.4] revalidates readings and doses when episode bounds move', async () => {
    const repository = createRepository()
    await repository.open()
    await startEpisode(repository, {
      id: 'episode-bounds',
      start: fixtureEventTime('2024-09-18T12:00'),
      note: null,
    })

    await saveReading(repository, {
      id: 'reading-bounds',
      episodeId: 'episode-bounds',
      measuredAt: fixtureEventTime('2024-09-18T13:00'),
      pain: { kind: 'numeric', value: 4 },
      impact: null,
      note: null,
      linkedDoseId: null,
      atOnset: false,
    })

    await expect(
      editEpisode(
        repository,
        'episode-bounds',
        { start: fixtureEventTime('2024-09-18T13:30') },
        { expectedRevision: repository.snapshot().facts?.metadata.revision },
      ),
    ).rejects.toMatchObject({
      code: 'validation-failed',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'child-before-start' })]),
    })

    await saveDose(repository, {
      id: 'dose-bounds',
      episodeId: 'episode-bounds',
      takenAt: fixtureEventTime('2024-09-18T13:00'),
      savedMedicineId: null,
      medicineName: 'Custom medicine',
      doseText: '1 tablet',
      followUpEnabled: false,
      followUpIntervalMinutes: 120,
    })

    await expect(
      finishEpisode(
        repository,
        'episode-bounds',
        fixtureEventTime('2024-09-18T12:30'),
        { expectedRevision: repository.snapshot().facts?.metadata.revision },
      ),
    ).rejects.toMatchObject({
      code: 'validation-failed',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'dose-after-end' })]),
    })
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

  it('[R-02.9] deletes only the selected episode and its children', async () => {
    const repository = createRepository()
    await repository.open()
    await startEpisode(repository, { id: 'episode-first', start: fixtureEventTime('2024-09-18T12:00'), note: null })
    await finishEpisode(repository, 'episode-first', fixtureEventTime('2024-09-18T13:00'))
    await startEpisode(repository, { id: 'episode-second', start: fixtureEventTime('2024-09-18T13:00'), note: null })
    await finishEpisode(repository, 'episode-second', fixtureEventTime('2024-09-18T14:00'))

    for (const [episodeId, suffix, time] of [
      ['episode-first', 'first', '2024-09-18T12:15'],
      ['episode-second', 'second', '2024-09-18T13:15'],
    ] as const) {
      await saveReading(repository, {
        id: `reading-${suffix}`,
        episodeId,
        measuredAt: fixtureEventTime(time),
        pain: { kind: 'numeric', value: 4 },
        impact: null,
        note: null,
        linkedDoseId: null,
        atOnset: false,
      })
      await saveDose(repository, {
        id: `dose-${suffix}`,
        episodeId,
        takenAt: fixtureEventTime(time),
        savedMedicineId: null,
        medicineName: 'Custom medicine',
        doseText: '1 tablet',
        followUpEnabled: false,
        followUpIntervalMinutes: 120,
      })
    }

    await deleteEpisode(repository, 'episode-first')

    const facts = await repository.read()
    expect(facts.episodes.map(({ id }) => id)).toEqual(['episode-second'])
    expect(facts.readings.map(({ id }) => id)).toEqual(['reading-second'])
    expect(facts.doses.map(({ id }) => id)).toEqual(['dose-second'])
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

  it('clears every covered day but not the day after a midnight end', async () => {
    const repository = createRepository()
    await repository.open()

    await startEpisode(repository, {
      id: 'multi-day-episode',
      start: fixtureEventTime('2024-09-16T12:00'),
      note: null,
    })

    const database = await repository.getDatabase()
    // Seed the three confirmations after Start; otherwise Start's own conflict
    // clearing would remove the future days before Finish is exercised.
    await database.dailyRecords.bulkPut(
      ['2024-09-16', '2024-09-17', '2024-09-18'].map((day) => ({
        day,
        headacheFreeAt: fixtureEventTime(`${day}T09:00`),
        alcohol: null,
        sleep: null,
        stress: null,
        createdAt: clock.now().toString(),
        updatedAt: clock.now().toString(),
      })),
    )

    await finishEpisode(repository, 'multi-day-episode', fixtureEventTime('2024-09-18T00:00'))
    await saveDailyRecord(repository, {
      day: '2024-09-18',
      headacheFreeAt: fixtureEventTime('2024-09-18T09:00'),
      alcohol: null,
      sleep: null,
      stress: null,
    })

    expect((await repository.read()).dailyRecords.map((record) => record.day)).toEqual(['2024-09-18'])
  })

  it('[R-02.7] clears a positive-pain confirmation without dropping day-before answers', async () => {
    const laterClock = fixedClock('2024-09-19T14:05:00Z', 'Europe/Helsinki')
    const repository = createRepository({ clock: laterClock })
    await repository.open()
    await startEpisode(repository, {
      id: 'episode-positive-reading',
      start: fixtureEventTime('2024-09-18T12:00'),
      note: null,
    })
    await finishEpisode(repository, 'episode-positive-reading', fixtureEventTime('2024-09-18T13:00'))
    await saveDailyRecord(repository, {
      day: '2024-09-19',
      headacheFreeAt: fixtureEventTime('2024-09-19T09:00'),
      alcohol: true,
      sleep: 'fair_amount',
      stress: false,
    })

    await saveReading(repository, {
      id: 'reading-positive',
      episodeId: 'episode-positive-reading',
      measuredAt: fixtureEventTime('2024-09-19T10:00'),
      pain: { kind: 'numeric', value: 4 },
      impact: null,
      note: null,
      linkedDoseId: null,
      atOnset: false,
    })

    const record = (await repository.read()).dailyRecords[0]
    expect(record).toMatchObject({ headacheFreeAt: null, alcohol: true, sleep: 'fair_amount', stress: false })
  })

  it('[R-05] expires Undo after the 24-hour window', async () => {
    const laterClock = fixedClock('2024-09-19T14:05:00Z', 'Europe/Helsinki')
    const repository = createRepository({ clock: laterClock })
    await repository.open()
    await startEpisode(repository, {
      id: 'episode-expired-undo',
      start: fixtureEventTime('2024-09-18T12:00'),
      note: null,
    })
    await finishEpisode(repository, 'episode-expired-undo', fixtureEventTime('2024-09-18T14:00'))

    await expect(undoEpisodeEnd(repository, 'episode-expired-undo')).rejects.toMatchObject({ code: 'undo-expired' })
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

  it('reports a newer on-device schema as a recoverable opening error', async () => {
    const newer = new Dexie(databaseName)
    newer.version(3).stores(DIARY_STORE_SCHEMAS)
    await newer.open()
    newer.close()

    const repository = createRepository()

    await expect(repository.open()).rejects.toThrow('newer app version')
    expect(repository.snapshot()).toMatchObject({ status: 'error', facts: undefined })
  })
})
