import { describe, expect, it } from 'vitest'

import { fixtureEventTime } from '../test/fixtures'
import {
  formatEventDate,
  formatEventTime,
  formatMonthLabel,
  weekdayLabels,
} from './locale'

describe('locale-aware diary formatting', () => {
  const event = fixtureEventTime('2024-09-18T16:05', 'Europe/Helsinki')

  it('formats an event in its recorded timezone instead of the device timezone', () => {
    const nearMidnight = fixtureEventTime('2024-09-19T00:05', 'Asia/Tokyo')

    expect(formatEventDate(nearMidnight, 'en-GB')).toBe('Thursday 19 September')
    expect(formatEventTime(nearMidnight, 'en-US')).toBe('12:05 AM')
  })

  it('formats month labels and weekday order from the active locale', () => {
    expect(formatMonthLabel(event, 'en-US')).toBe('September 2024')
    expect(weekdayLabels('en-GB')).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])
    expect(weekdayLabels('en-US')[0]).toBe('Sunday')
  })
})
