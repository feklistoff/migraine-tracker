import { systemClock, type Clock } from '../domain/time'

export function appClock(): Clock {
  return systemClock()
}
