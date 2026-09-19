import { fixedClock, resolveCivilDateTime } from '../domain/time'
import type {
  DiaryFacts,
  DiaryMetadata,
  Dose,
  Episode,
  Reading,
  SavedMedicine,
  Settings,
} from '../domain/types'

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

function facts(overrides: Partial<DiaryFacts> = {}): DiaryFacts {
  return {
    metadata: metadata(),
    settings: settings(),
    episodes: [],
    readings: [],
    doses: [],
    medicines: [],
    dailyRecords: [],
    ...overrides,
  }
}

function episode(id: string, start: string, state: Episode['state'], end: string | null = null): Episode {
  return {
    ...audit,
    id,
    start: fixtureEventTime(start),
    state,
    end: end ? fixtureEventTime(end) : null,
    note: null,
  }
}

function reading(
  id: string,
  episodeId: string,
  measuredAt: string,
  pain: Reading['pain'],
  impact: Reading['impact'] = null,
): Reading {
  return {
    ...audit,
    id,
    episodeId,
    measuredAt: fixtureEventTime(measuredAt),
    pain,
    impact,
    note: null,
    linkedDoseId: null,
    atOnset: false,
  }
}

function dose(id: string, episodeId: string, takenAt: string): Dose {
  return {
    ...audit,
    id,
    episodeId,
    takenAt: fixtureEventTime(takenAt),
    savedMedicineId: 'medicine-ibuprofen',
    medicineName: 'Ibuprofen',
    doseText: '400 mg',
    followUpEnabled: true,
    followUpIntervalMinutes: 120,
  }
}

function medicine(): SavedMedicine {
  return {
    ...audit,
    id: 'medicine-ibuprofen',
    name: 'Ibuprofen',
    doseText: '400 mg',
    archived: false,
  }
}

export function emptyDiaryFixture(): DiaryFacts {
  return facts()
}

export function incompleteEpisodeFixture(): DiaryFacts {
  return facts({ episodes: [episode('episode-incomplete', '2024-09-18T12:00', 'ongoing')] })
}

export function endedEpisodeFixture(): DiaryFacts {
  const ended = episode('episode-ended', '2024-09-18T12:00', 'ended', '2024-09-18T13:00')
  return facts({
    episodes: [ended],
    readings: [reading('reading-ended', ended.id, '2024-09-18T12:00', { kind: 'numeric', value: 5 }, 'slowed')],
  })
}

export function ongoingEpisodeFixture(): DiaryFacts {
  const ongoing = episode('episode-ongoing', '2024-09-18T14:00', 'ongoing')
  return facts({ episodes: [ongoing], readings: [reading('reading-ongoing', ongoing.id, '2024-09-18T14:01', null)] })
}

export function unknownEndedEpisodeFixture(): DiaryFacts {
  const unknown = episode('episode-unknown', '2024-09-18T12:00', 'end_unknown')
  return facts({ episodes: [unknown], readings: [reading('reading-unknown', unknown.id, '2024-09-18T12:30', { kind: 'numeric', value: 3 })] })
}

export function multipleDoseFixture(): DiaryFacts {
  const ended = episode('episode-doses', '2024-09-18T12:00', 'ended', '2024-09-18T15:00')
  return facts({
    episodes: [ended],
    medicines: [medicine()],
    doses: [dose('dose-first', ended.id, '2024-09-18T12:30'), dose('dose-second', ended.id, '2024-09-18T13:45')],
    readings: [reading('reading-dose', ended.id, '2024-09-18T12:15', { kind: 'numeric', value: 7 })],
  })
}

export function mixedPainFixture(): DiaryFacts {
  const ended = episode('episode-mixed', '2024-09-18T12:00', 'ended', '2024-09-18T14:00')
  return facts({
    episodes: [ended],
    readings: [
      reading('reading-numeric', ended.id, '2024-09-18T12:00', { kind: 'numeric', value: 7 }),
      reading('reading-verbal', ended.id, '2024-09-18T12:30', { kind: 'verbal', value: 'mild' }),
      reading('reading-null', ended.id, '2024-09-18T13:00', null),
    ],
  })
}
