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

  // The ends of every accepted range, since those are the values an off-by-one would let through
  // or turn away. Day 31 is deliberate: Deepnote's own scheduling UI offers 1-31, so a month
  // without that date is a skipped run rather than an invalid schedule.
  it.each([
    [{ frequency: 'daily', time: '00:00' } as const, '0 0 * * *', 'Daily at 00:00'],
    [{ frequency: 'daily', time: '23:59' } as const, '59 23 * * *', 'Daily at 23:59'],
    [{ frequency: 'weekly', dayOfWeek: 0, time: '00:00' } as const, '0 0 * * 0', 'Every Sunday at 00:00'],
    [{ frequency: 'weekly', dayOfWeek: 6, time: '23:59' } as const, '59 23 * * 6', 'Every Saturday at 23:59'],
    [{ frequency: 'monthly', dayOfMonth: 1, time: '00:00' } as const, '0 0 1 * *', 'Monthly on day 1 at 00:00'],
    [{ frequency: 'monthly', dayOfMonth: 31, time: '23:59' } as const, '59 23 31 * *', 'Monthly on day 31 at 23:59'],
  ])('resolves boundary schedule %# exactly', (schedule, cron, description) => {
    expect(resolveRecurringSchedule(schedule)).toEqual({ cron, description })
  })

  it('accepts surrounding whitespace in "time"', () => {
    expect(resolveRecurringSchedule({ frequency: 'daily', time: '  07:15  ' } as never)).toEqual({
      cron: '15 7 * * *',
      description: 'Daily at 07:15',
    })
  })

  it.each([
    [null, /object/],
    [undefined, /object/],
    ['daily', /object/],
    // An array is object-typed, so it needs its own rejection rather than falling out of `typeof`.
    [[{ frequency: 'daily', time: '09:00' }], /object/],
    [{ frequency: 'hourly', time: '09:00' }, /frequency/],
    [{ frequency: 'DAILY', time: '09:00' }, /frequency/],
    [{ time: '09:00' }, /frequency/],
    [{ frequency: 'daily' }, /time/],
    [{ frequency: 'daily', time: '24:00' }, /hour/],
    [{ frequency: 'daily', time: '09:60' }, /minute/],
    // Times that are the right shape but not the right characters: a cron field, a range, a
    // seconds-precision time, and separators that are not a colon.
    [{ frequency: 'daily', time: '*:00' }, /HH:mm/],
    [{ frequency: 'daily', time: '9-17:00' }, /HH:mm/],
    [{ frequency: 'daily', time: '09:00:00' }, /HH:mm/],
    [{ frequency: 'daily', time: '09.30' }, /HH:mm/],
    [{ frequency: 'daily', time: '09:3' }, /HH:mm/],
    [{ frequency: 'daily', time: '09 : 30' }, /HH:mm/],
    [{ frequency: 'daily', time: '' }, /HH:mm/],
    [{ frequency: 'daily', time: '09:30\n0 0 * * *' }, /HH:mm/],
    [{ frequency: 'daily', time: 930 }, /HH:mm/],
    [{ frequency: 'weekly', time: '09:00', dayOfWeek: 7 }, /dayOfWeek/],
    [{ frequency: 'weekly', time: '09:00', dayOfWeek: -1 }, /dayOfWeek/],
    [{ frequency: 'weekly', time: '09:00', dayOfWeek: 1.5 }, /dayOfWeek/],
    [{ frequency: 'weekly', time: '09:00', dayOfWeek: '5' }, /dayOfWeek/],
    [{ frequency: 'weekly', time: '09:00' }, /dayOfWeek/],
    [{ frequency: 'monthly', time: '09:00', dayOfMonth: 0 }, /dayOfMonth/],
    [{ frequency: 'monthly', time: '09:00', dayOfMonth: 32 }, /dayOfMonth/],
    [{ frequency: 'monthly', time: '09:00', dayOfMonth: 1.5 }, /dayOfMonth/],
    [{ frequency: 'monthly', time: '09:00', dayOfMonth: '15' }, /dayOfMonth/],
    [{ frequency: 'monthly', time: '09:00' }, /dayOfMonth/],
  ])('rejects invalid schedule %#', (schedule, error) => {
    expect(() => resolveRecurringSchedule(schedule as never)).toThrow(RecurringScheduleError)
    expect(() => resolveRecurringSchedule(schedule as never)).toThrow(error)
  })
})
