import { describe, expect, it } from 'vitest'
import { resolveScheduleExpression, ScheduleExpressionError } from './schedule-expression'

describe('resolveScheduleExpression', () => {
  it.each([
    [{ hourly: true }, '0 * * * *', 'hourly'],
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

  it.each([
    [{}, /Choose a schedule/],
    [{ hourly: true, daily: true }, /only one/],
    [{ hourly: true, at: '09:00' }, /cannot be combined/],
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
