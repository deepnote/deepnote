import { describe, expect, it } from 'vitest'
import { RecurringScheduleError, resolveRecurringSchedule } from './recurring-schedule'

describe('resolveRecurringSchedule', () => {
  it.each([
    [{ frequency: 'daily', time: '09:30' } as const, '30 9 * * *', 'Daily at 09:30'],
    [{ frequency: 'weekly', dayOfWeek: 5, time: '17:45' } as const, '45 17 * * 5', 'Every Friday at 17:45'],
    [{ frequency: 'monthly', dayOfMonth: 23, time: '8:05' } as const, '5 8 23 * *', 'Monthly on day 23 at 08:05'],
  ])('resolves %# to cron', (schedule, cron, description) => {
    expect(resolveRecurringSchedule(schedule)).toEqual({ cron, description })
  })

  it.each([
    [null, /object/],
    [{ frequency: 'hourly', time: '09:00' }, /frequency/],
    [{ frequency: 'daily' }, /time/],
    [{ frequency: 'daily', time: '24:00' }, /hour/],
    [{ frequency: 'daily', time: '09:60' }, /minute/],
    [{ frequency: 'weekly', time: '09:00', dayOfWeek: 7 }, /dayOfWeek/],
    [{ frequency: 'weekly', time: '09:00', dayOfWeek: 1.5 }, /dayOfWeek/],
    [{ frequency: 'monthly', time: '09:00', dayOfMonth: 0 }, /dayOfMonth/],
    [{ frequency: 'monthly', time: '09:00', dayOfMonth: 32 }, /dayOfMonth/],
  ])('rejects invalid schedule %#', (schedule, error) => {
    expect(() => resolveRecurringSchedule(schedule as never)).toThrow(RecurringScheduleError)
    expect(() => resolveRecurringSchedule(schedule as never)).toThrow(error)
  })
})
