import { describe, expect, it } from 'vitest'
import {
  resolveScheduleAddition,
  resolveScheduleChange,
  resolveScheduleExpression,
  ScheduleExpressionError,
} from './schedule-expression'

describe('resolveScheduleExpression', () => {
  it.each([
    [{ hourly: true, at: ':00' }, '0 * * * *', 'hourly at :00'],
    [{ hourly: true, at: ':59' }, '59 * * * *', 'hourly at :59'],
    [{ hourly: true, at: ':15' }, '15 * * * *', 'hourly at :15'],
    [{ hourly: true, at: '7' }, '7 * * * *', 'hourly at :07'],
    [{ hourly: true, at: '00:45' }, '45 * * * *', 'hourly at :45'],
    [{ daily: true, at: '9:05' }, '5 9 * * *', 'daily at 09:05'],
    [{ weekly: 'Monday', at: '17:30' }, '30 17 * * 1', 'weekly on Mon at 17:30'],
    [{ weekly: 'fri', at: '09:00' }, '0 9 * * 5', 'weekly on Fri at 09:00'],
    [{ monthly: '15', at: '00:00' }, '0 0 15 * *', 'monthly on day 15 at 00:00'],
    [{ cron: ' 0 6 * * 1-5 ' }, '0 6 * * 1-5', 'cron 0 6 * * 1-5'],
  ] as const)('converts %j into cron', (options, cron, description) => {
    expect(resolveScheduleExpression({ ...options, timezone: 'Europe/London' })).toEqual({
      cron,
      timezone: 'Europe/London',
      description,
    })
  })

  it('defaults to the system timezone', () => {
    // The resolved zone itself, not merely "something non-empty" — that would pass just as well if
    // the function ignored the system clock and hardcoded a fallback. `|| 'UTC'` mirrors the one
    // case `resolveTimezone` has to cover, an environment that reports no zone at all.
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

    const result = resolveScheduleExpression({ daily: true })

    expect(result.timezone).toBe(systemTimezone)
  })

  // Deepnote's scheduling UI defaults every new schedule to the current hour and minute so runs do
  // not pile onto the same execution spike. A CLI defaulting to 09:00 would be the spike.
  it.each([
    [{ daily: true } as const, '37 14 * * *', 'daily at 14:37'],
    [{ weekly: 'Monday' } as const, '37 14 * * 1', 'weekly on Mon at 14:37'],
    [{ monthly: '15' } as const, '37 14 15 * *', 'monthly on day 15 at 14:37'],
  ])('defaults %# to the creation time rather than a fixed hour', (options, cron, description) => {
    const result = resolveScheduleExpression({ ...options, timezone: 'UTC' }, new Date(2026, 2, 4, 14, 37))

    expect(result.cron).toBe(cron)
    expect(result.description).toBe(description)
  })

  it('spreads same-cadence schedules created at different times', () => {
    const first = resolveScheduleExpression({ daily: true }, new Date(2026, 2, 4, 6, 8))
    const second = resolveScheduleExpression({ daily: true }, new Date(2026, 2, 4, 21, 52))

    expect(first.cron).toBe('8 6 * * *')
    expect(second.cron).toBe('52 21 * * *')
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

describe('resolveScheduleChange', () => {
  it.each([
    [{ hourly: true, at: ':15' }, '15 * * * *', 'hourly at :15'],
    [{ daily: true, at: '09:00' }, '0 9 * * *', 'daily at 09:00'],
    [{ weekly: 'Mon', at: '08:30' }, '30 8 * * 1', 'weekly on Mon at 08:30'],
    [{ monthly: '1', at: '06:00' }, '0 6 1 * *', 'monthly on day 1 at 06:00'],
    [{ cron: '0 6 * * 1-5' }, '0 6 * * 1-5', 'cron 0 6 * * 1-5'],
  ] as const)('converts %j and keeps the stored timezone', (options, cron, description) => {
    expect(resolveScheduleChange(options)).toStrictEqual({ cron, description })
  })

  it('changes the timezone along with the timing', () => {
    expect(resolveScheduleChange({ daily: true, at: '09:00', timezone: 'Europe/Prague' })).toStrictEqual({
      cron: '0 9 * * *',
      description: 'daily at 09:00',
      timezone: 'Europe/Prague',
    })
  })

  it('changes only the timezone when no frequency is passed', () => {
    expect(resolveScheduleChange({ timezone: ' Europe/Prague ' })).toStrictEqual({ timezone: 'Europe/Prague' })
  })

  it('counts an empty --timezone as omitted rather than using the system timezone', () => {
    expect(resolveScheduleChange({ daily: true, at: '09:00', timezone: ' ' })).toStrictEqual({
      cron: '0 9 * * *',
      description: 'daily at 09:00',
    })
  })

  it.each([[{}], [{ timezone: '' }]] as const)('changes no timing for %j', options => {
    expect(resolveScheduleChange(options)).toStrictEqual({})
  })

  it.each([
    [{ hourly: true }, /With --schedule-id, a frequency needs --at/],
    [{ daily: true }, /a frequency needs --at/],
    [{ weekly: 'Monday' }, /a frequency needs --at/],
    [{ monthly: '1' }, /a frequency needs --at/],
    [{ at: '09:00' }, /--at needs a frequency/],
    [{ at: '09:00', timezone: 'UTC' }, /--at needs a frequency/],
    [{ timezone: 'Mars/Olympus' }, /Invalid timezone/],
  ] as const)('rejects %j', (options, expected) => {
    expect(() => resolveScheduleChange(options)).toThrow(ScheduleExpressionError)
    expect(() => resolveScheduleChange(options)).toThrow(expected)
  })
})

describe('resolveScheduleAddition', () => {
  it('needs --at with a frequency and defaults to the system timezone', () => {
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

    expect(resolveScheduleAddition({ daily: true, at: '18:00' })).toEqual({
      cron: '0 18 * * *',
      timezone: systemTimezone,
      description: 'daily at 18:00',
    })
    expect(resolveScheduleAddition({ cron: '0 6 * * 1-5', timezone: 'UTC' }).cron).toBe('0 6 * * 1-5')
    expect(() => resolveScheduleAddition({ weekly: 'Monday' })).toThrow(/With --add, a frequency needs --at/)
    expect(() => resolveScheduleAddition({})).toThrow(/Choose a schedule/)
  })
})
