import type { RecordedTime } from '../domain/types'

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

type LocaleWithWeekInfo = Intl.Locale & {
  weekInfo?: {
    firstDay?: number
  }
}

export function deviceLocale(): string {
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en'
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function firstDayOfWeek(locale: string): number {
  const weekInfo = (new Intl.Locale(locale) as LocaleWithWeekInfo).weekInfo
  const firstDay = weekInfo?.firstDay
  return firstDay && firstDay >= 1 && firstDay <= 7 ? firstDay : 1
}

function formatWeekday(weekday: number, locale: string): string {
  // 2024-01-01 was a Monday, so this stays independent of the host timezone.
  const date = new Date(Date.UTC(2024, 0, weekday))
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(date)
}

function eventDate(value: RecordedTime): Date {
  return new Date(value.instant)
}

export function formatEventDate(value: RecordedTime, locale = deviceLocale()): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: value.timeZone,
  }).format(eventDate(value))
}

export function formatEventTime(value: RecordedTime, locale = deviceLocale()): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: value.timeZone,
  }).format(eventDate(value))
}

export function formatMonthLabel(value: RecordedTime, locale = deviceLocale()): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: value.timeZone,
  }).format(eventDate(value))
}

export function weekdayLabels(locale = deviceLocale()): string[] {
  const firstDay = firstDayOfWeek(locale)
  return ISO_WEEKDAYS.map((offset) => ((firstDay - 1 + offset - 1) % 7) + 1).map((weekday) =>
    formatWeekday(weekday, locale),
  )
}
