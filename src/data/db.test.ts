import { afterEach, describe, expect, it } from 'vitest'

import { deleteDiaryDatabase, openDiaryDatabase } from './db'
import { fixtureClock } from '../test/fixtures'

const databaseName = 'headache-diary-schema-tests'

afterEach(async () => {
  await deleteDiaryDatabase(databaseName)
})

describe('diary IndexedDB schema', () => {
  it('opens the versioned stores with the indexes needed by repository commands', async () => {
    const database = await openDiaryDatabase({ name: databaseName, clock: fixtureClock })

    expect(database.verno).toBe(1)
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
      'alcohol',
      'sleep',
      'stress',
    ])

    database.close()
  })
})
