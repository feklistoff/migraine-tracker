import { fixedClock, resolveCivilDateTime } from '../domain/time'
import type { DiaryFacts, DiaryMetadata, Settings } from '../domain/types'

export const fixtureClock = fixedClock('2024-09-18T14:05:00Z', 'Europe/Helsinki')

export function fixtureEventTime(localDateTime: string, timeZone = 'Europe/Helsinki') {
  const [date, time] = localDateTime.split('T')
  const result = resolveCivilDateTime({ date, time, timeZone })
  if (!result.ok) throw new Error(result.message)
  return result.time
}

const audit = {
  createdAt: '2024-09-18T10:00:00Z',
  updatedAt: '2024-09-18T10:00:00Z',
}

function metadata(): DiaryMetadata {
  return {
    ...audit,
    schemaVersion: 2,
    revision: 0,
    timeZonePolicy: 'event-local',
    lastExportGeneratedAt: null,
  }
}

function settings(): Settings {
  return {
    ...audit,
    painEntryDefault: 'numeric',
    followUpEnabled: true,
    followUpIntervalMinutes: 120,
    defaultMedicineId: null,
  }
}

function facts(): DiaryFacts {
  return {
    metadata: metadata(),
    settings: settings(),
    episodes: [],
    readings: [],
    doses: [],
    medicines: [],
    dailyRecords: [],
  }
}

export function emptyDiaryFixture(): DiaryFacts {
  return facts()
}
