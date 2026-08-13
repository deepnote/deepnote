export type RecurringSchedule =
  | { frequency: 'daily'; time: string }
  | { frequency: 'weekly'; time: string; dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6 }
  | { frequency: 'monthly'; time: string; dayOfMonth: number }

export interface ResolvedRecurringSchedule {
  cron: string
  description: string
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export class RecurringScheduleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecurringScheduleError'
  }
}

/** Convert a friendly recurring cadence into the five-field cron accepted by Deepnote Cloud. */
export function resolveRecurringSchedule(schedule: RecurringSchedule): ResolvedRecurringSchedule {
  if (typeof schedule !== 'object' || schedule === null || Array.isArray(schedule)) {
    throw new RecurringScheduleError('Schedule must be an object.')
  }

  const value = schedule as RecurringSchedule
  const { hour, minute, display } = parseTime(value.time)

  if (value.frequency === 'daily') {
    return { cron: `${minute} ${hour} * * *`, description: `Daily at ${display}` }
  }

  if (value.frequency === 'weekly') {
    if (!Number.isInteger(value.dayOfWeek) || value.dayOfWeek < 0 || value.dayOfWeek > 6) {
      throw new RecurringScheduleError('Weekly schedule "dayOfWeek" must be an integer from 0 (Sunday) to 6.')
    }
    return {
      cron: `${minute} ${hour} * * ${value.dayOfWeek}`,
      description: `Every ${WEEKDAYS[value.dayOfWeek]} at ${display}`,
    }
  }

  if (value.frequency === 'monthly') {
    if (!Number.isInteger(value.dayOfMonth) || value.dayOfMonth < 1 || value.dayOfMonth > 31) {
      throw new RecurringScheduleError('Monthly schedule "dayOfMonth" must be an integer from 1 to 31.')
    }
    return {
      cron: `${minute} ${hour} ${value.dayOfMonth} * *`,
      description: `Monthly on day ${value.dayOfMonth} at ${display}`,
    }
  }

  throw new RecurringScheduleError('Schedule "frequency" must be "daily", "weekly", or "monthly".')
}

function parseTime(value: unknown): { hour: number; minute: number; display: string } {
  if (typeof value !== 'string') {
    throw new RecurringScheduleError('Schedule "time" must use 24-hour HH:mm format, for example 09:30.')
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) {
    throw new RecurringScheduleError('Schedule "time" must use 24-hour HH:mm format, for example 09:30.')
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    throw new RecurringScheduleError('Schedule "time" must contain an hour from 0-23 and minute from 0-59.')
  }
  return { hour, minute, display: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
}
