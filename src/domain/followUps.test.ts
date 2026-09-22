import { Temporal } from '@js-temporal/polyfill'
import { describe, expect, it } from 'vitest'

import { eventTimeFromInstant } from './time'
import type { Dose, Reading } from './types'
import { emptyDiaryFixture, fixtureEventTime } from '../test/fixtures'
import { deriveDoseFollowUps, followUpDueTime, responseDelayMilliseconds, todayFollowUps } from './followUps'

const audit = {
  createdAt: '2024-09-18T10:00:00.000Z',
  updatedAt: '2024-09-18T10:00:00.000Z',
}

function dose(id: string, takenAt: string, overrides: Partial<Dose> = {}): Dose {
  return {
    ...audit,
    id,
    episodeId: 'episode-1',
    takenAt: fixtureEventTime(takenAt),
    savedMedicineId: null,
    medicineName: 'Ibuprofen',
    doseText: '400 mg',
    followUpEnabled: true,
    followUpIntervalMinutes: 60,
    ...overrides,
  }
}

function reading(id: string, measuredAt: string, linkedDoseId: string | null): Reading {
  return {
    ...audit,
    id,
    episodeId: 'episode-1',
    measuredAt: fixtureEventTime(measuredAt),
    pain: { kind: 'numeric', value: 3 },
    impact: null,
    note: null,
    linkedDoseId,
    atOnset: false,
  }
}

describe('dose follow-ups', () => {
  it('moves from pending to overdue and expires at the exact 24-hour boundary', () => {
    const recordedDose = dose('dose-1', '2024-09-18T12:00')
    const dueAt = followUpDueTime(recordedDose.takenAt, recordedDose.followUpIntervalMinutes)
    const expiresAt = eventTimeFromInstant(
      Temporal.Instant.from(dueAt.instant).add({ hours: 24 }),
      dueAt.timeZone,
    )
    const oneMillisecondBeforeExpiry = eventTimeFromInstant(
      Temporal.Instant.from(expiresAt.instant).subtract({ milliseconds: 1 }),
      expiresAt.timeZone,
    )

    expect(deriveDoseFollowUps([recordedDose], [], fixtureEventTime('2024-09-18T12:59'))[0]?.status).toBe('pending')
    expect(deriveDoseFollowUps([recordedDose], [], dueAt)[0]?.status).toBe('overdue')
    expect(deriveDoseFollowUps([recordedDose], [], oneMillisecondBeforeExpiry)[0]?.status).toBe('overdue')
    expect(deriveDoseFollowUps([recordedDose], [], expiresAt)[0]?.status).toBe('expired')
  })

  it('keeps independent readings separate and preserves an older dose response', () => {
    const earlierDose = dose('dose-earlier', '2024-09-18T12:00')
    const latestDose = dose('dose-latest', '2024-09-18T13:30')
    const independentReading = reading('reading-independent', '2024-09-18T13:45', null)
    const now = fixtureEventTime('2024-09-18T14:05')

    const withoutResponse = deriveDoseFollowUps([earlierDose, latestDose], [independentReading], now)
    expect(withoutResponse.map(({ status }) => status)).toEqual(['superseded', 'pending'])

    const response = reading('reading-response', '2024-09-18T13:20', earlierDose.id)
    const withResponse = deriveDoseFollowUps([earlierDose, latestDose], [independentReading, response], now)
    expect(withResponse.map(({ status }) => status)).toEqual(['answered', 'pending'])
    expect(responseDelayMilliseconds(earlierDose, response)).toBe(80 * 60 * 1000)
    expect(withResponse[0]?.response?.measuredAt).toEqual(response.measuredAt)
  })

  it('marks disabled checks and suppresses Today checks while the global setting is off', () => {
    const overdueDose = dose('dose-overdue', '2024-09-18T12:30', { episodeId: 'episode-overdue' })
    const pendingDose = dose('dose-pending', '2024-09-18T13:45', { episodeId: 'episode-pending' })
    const expiredDose = dose('dose-expired', '2024-09-16T12:00', { episodeId: 'episode-expired' })
    const disabledDose = dose('dose-disabled', '2024-09-18T13:45', {
      episodeId: 'episode-disabled',
      followUpEnabled: false,
    })
    const answeredDose = dose('dose-answered', '2024-09-18T12:00', { episodeId: 'episode-answered' })
    const response = { ...reading('reading-answered', '2024-09-18T13:05', answeredDose.id), episodeId: answeredDose.episodeId }
    const doses = [pendingDose, disabledDose, expiredDose, answeredDose, overdueDose]
    const checks = deriveDoseFollowUps(doses, [response], fixtureEventTime('2024-09-18T14:05'))

    expect(checks.find(({ dose: item }) => item.id === disabledDose.id)).toMatchObject({
      dueAt: null,
      expiresAt: null,
      status: 'disabled',
    })
    const facts = emptyDiaryFixture()
    facts.settings.followUpEnabled = false
    facts.readings = [response]
    facts.doses = doses
    expect(todayFollowUps(facts, fixtureEventTime('2024-09-18T14:05'))).toEqual([])

    facts.settings.followUpEnabled = true
    expect(todayFollowUps(facts, fixtureEventTime('2024-09-18T14:05')).map(({ dose: item }) => item.id)).toEqual([
      overdueDose.id,
      pendingDose.id,
    ])
  })
})
