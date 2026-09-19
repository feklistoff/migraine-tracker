import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { deleteDiaryDatabase, openDiaryDatabase } from './db'
import { DIARY_STORE_SCHEMAS } from './migrations'
import { fixtureClock } from '../test/fixtures'

const databaseName = 'headache-diary-schema-tests'

afterEach(async () => {
  await deleteDiaryDatabase(databaseName)
})

describe('diary IndexedDB schema', () => {
  it('opens the supported versioned stores and indexes', async () => {
    const database = await openDiaryDatabase({ name: databaseName, clock: fixtureClock })

    expect(database.verno).toBe(2)
    expect(database.tables.map((table) => table.name)).toEqual([
      'metadata',
      'settings',
      'episodes',
      'readings',
      'doses',
      'medicines',
      'dailyRecords',
    ])
    expect(database.episodes.schema.indexes.map((index) => index.name)).toEqual([
      'state',
      'start.instant',
      'end.instant',
    ])
    expect(database.readings.schema.indexes.map((index) => index.name)).toEqual([
      'episodeId',
      'measuredAt.instant',
      'linkedDoseId',
    ])
    expect(database.doses.schema.indexes.map((index) => index.name)).toEqual([
      'episodeId',
      'takenAt.instant',
      'savedMedicineId',
    ])
    expect(database.dailyRecords.schema.indexes.map((index) => index.name)).toEqual([
      'headacheFreeAt.instant',
      'sleep',
    ])

    database.close()
  })

  it('removes the unsupported boolean indexes when upgrading a version 1 database', async () => {
    const legacy = new Dexie(databaseName)
    legacy.version(1).stores({
      ...DIARY_STORE_SCHEMAS,
      dailyRecords: 'day,headacheFreeAt.instant,alcohol,sleep,stress',
    })
    await legacy.open()
    legacy.close()

    const database = await openDiaryDatabase({ name: databaseName, clock: fixtureClock })

    expect(database.verno).toBe(2)
    expect(database.dailyRecords.schema.indexes.map((index) => index.name)).toEqual([
      'headacheFreeAt.instant',
      'sleep',
    ])

    database.close()
  })
})
