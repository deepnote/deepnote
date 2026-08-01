import { describe, expect, it } from 'vitest'
import { resolveScheduleExpression, ScheduleExpressionError } from './schedule-expression'

describe('resolveScheduleExpression', () => {
  it.each([
    [{ hourly: true, at: ':00' }, '0 * * * *', 'hourly at :00'],
    [{ hourly: true, at: ':59' }, '59 * * * *', 'hourly at :59'],
    [{ hourly: true, at: ':15' }, '15 * * * *', 'hourly at :15'],
    [{ hourly: true, at: '7' }, '7 * * * *', 'hourly at :07'],
    [{ hourly: true, at: '00:45' }, '45 * * * *', 'hourly at :45'],
    [{ daily: true, at: '9:05' }, '5 9 * * *', 'daily at 09:05'],
    [{ weekly: 'Monday', at: '17:30' }, '30 17 * * 1', 'weekly on Mon at 17:30'],
    [{ weekly: 'fri' }, '0 9 * * 5', 'weekly on Fri at 09:00'],
    [{ monthly: '15', at: '00:00' }, '0 0 15 * *', 'monthly on day 15 at 00:00'],
    [{ cron: ' 0 6 * * 1-5 ' }, '0 6 * * 1-5', 'cron 0 6 * * 1-5'],
  ] as const)('converts %j into cron', (options, cron, description) => {
    expect(resolveScheduleExpression({ ...options, timezone: 'Europe/London' })).toEqual({
      cron,
      timezone: 'Europe/London',
      description,
    })
  })

  it('defaults friendly schedules to 09:00 and the system timezone', () => {
    const result = resolveScheduleExpression({ daily: true })

    expect(result.cron).toBe('0 9 * * *')
    expect(result.timezone).toBeTruthy()
  })

  // Local-time constructors, not `Z` timestamps: the minute is read off the local clock, and a
  // timezone offset by a half hour (India, Nepal) would shift a UTC instant onto another minute.
  it('defaults --hourly to the creation minute rather than the top of the hour', () => {
    const result = resolveScheduleExpression({ hourly: true }, new Date(2026, 2, 4, 10, 37))

    expect(result.cron).toBe('37 * * * *')
    expect(result.description).toBe('hourly at :37')
  })

  it('spreads hourly schedules created in different minutes', () => {
    const first = resolveScheduleExpression({ hourly: true }, new Date(2026, 2, 4, 10, 8))
    const second = resolveScheduleExpression({ hourly: true }, new Date(2026, 2, 4, 10, 52))

    expect(first.cron).toBe('8 * * * *')
    expect(second.cron).toBe('52 * * * *')
  })

  it.each([
    [{}, /Choose a schedule/],
    [{ hourly: true, daily: true }, /only one/],
    [{ hourly: true, at: '09:00' }, /has no use for/],
    [{ hourly: true, at: ':60' }, /minute from 0-59/],
    [{ hourly: true, at: '9am' }, /24-hour HH:mm/],
    [{ cron: '0 * * * *', at: '09:00' }, /cannot be combined/],
    [{ weekly: 'Tomorrow' }, /Invalid weekday/],
    [{ monthly: '0' }, /integer from 1 to 31/],
    [{ monthly: '32' }, /integer from 1 to 31/],
    [{ daily: true, at: '24:00' }, /Hour must be 0-23/],
    [{ daily: true, at: '9am' }, /24-hour HH:mm/],
    [{ daily: true, timezone: 'Mars/Olympus' }, /Invalid timezone/],
    [{ cron: ' ' }, /cannot be empty/],
    [{ cron: '0 9 * *' }, /exactly five fields/],
  ] as const)('rejects invalid options %j', (options, expected) => {
    expect(() => resolveScheduleExpression(options)).toThrow(ScheduleExpressionError)
    expect(() => resolveScheduleExpression(options)).toThrow(expected)
  })
})
