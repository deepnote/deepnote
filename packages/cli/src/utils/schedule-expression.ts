export interface ScheduleExpressionOptions {
  hourly?: boolean
  daily?: boolean
  weekly?: string
  monthly?: string
  cron?: string
  at?: string
  timezone?: string
}

export interface ResolvedScheduleExpression {
  cron: string
  timezone: string
  description: string
}

const WEEKDAYS = new Map<string, number>([
  ['sunday', 0],
  ['sun', 0],
  ['monday', 1],
  ['mon', 1],
  ['tuesday', 2],
  ['tue', 2],
  ['wednesday', 3],
  ['wed', 3],
  ['thursday', 4],
  ['thu', 4],
  ['friday', 5],
  ['fri', 5],
  ['saturday', 6],
  ['sat', 6],
])

export class ScheduleExpressionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduleExpressionError'
  }
}

/**
 * Convert friendly CLI schedule flags into the cron + timezone accepted by Deepnote Cloud.
 *
 * `now` decides the default minute of an `--hourly` schedule and is injectable for tests; every
 * other cadence is a pure function of its flags.
 */
export function resolveScheduleExpression(
  options: ScheduleExpressionOptions,
  now: Date = new Date()
): ResolvedScheduleExpression {
  const choices = [
    options.hourly ? 'hourly' : undefined,
    options.daily ? 'daily' : undefined,
    options.weekly !== undefined ? 'weekly' : undefined,
    options.monthly !== undefined ? 'monthly' : undefined,
    options.cron !== undefined ? 'cron' : undefined,
  ].filter((choice): choice is string => choice !== undefined)

  if (choices.length === 0) {
    throw new ScheduleExpressionError(
      'Choose a schedule: --hourly, --daily, --weekly <day>, --monthly <day>, or --cron <expression>.'
    )
  }
  if (choices.length > 1) {
    throw new ScheduleExpressionError(
      `Choose only one schedule; received ${choices.map(choice => `--${choice}`).join(', ')}.`
    )
  }

  const timezone = resolveTimezone(options.timezone)
  if (options.cron !== undefined) {
    const cron = options.cron.trim()
    if (!cron) {
      throw new ScheduleExpressionError('--cron cannot be empty.')
    }
    if (cron.split(/\s+/).length !== 5) {
      throw new ScheduleExpressionError('--cron must contain exactly five fields, for example "0 9 * * 1-5".')
    }
    if (options.at !== undefined) {
      throw new ScheduleExpressionError('--at cannot be combined with --cron; put the time in the cron expression.')
    }
    return { cron, timezone, description: `cron ${cron}` }
  }
  if (options.hourly) {
    const minute = options.at === undefined ? now.getMinutes() : parseHourlyMinute(options.at)
    return {
      cron: `${minute} * * * *`,
      timezone,
      description: `hourly at :${String(minute).padStart(2, '0')}`,
    }
  }

  // The creation time, not a round number. Deepnote's own scheduling UI defaults every new schedule
  // to the current hour and minute for exactly this reason — a fixed default piles everyone's runs
  // onto the same execution spike, and 09:00 is a worse offender than most. `--at` still pins one.
  const { hour, minute, display } = parseTime(options.at ?? formatTime(now))
  if (options.daily) {
    return { cron: `${minute} ${hour} * * *`, timezone, description: `daily at ${display}` }
  }
  if (options.weekly !== undefined) {
    const normalized = options.weekly.trim().toLowerCase()
    const weekday = WEEKDAYS.get(normalized)
    if (weekday === undefined) {
      throw new ScheduleExpressionError(
        `Invalid weekday "${options.weekly}". Use Monday-Sunday (abbreviations such as Mon are accepted).`
      )
    }
    const name = normalized.slice(0, 3)
    return {
      cron: `${minute} ${hour} * * ${weekday}`,
      timezone,
      description: `weekly on ${name[0].toUpperCase()}${name.slice(1)} at ${display}`,
    }
  }

  const day = Number(options.monthly)
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new ScheduleExpressionError('--monthly <day> must be an integer from 1 to 31.')
  }
  return {
    cron: `${minute} ${hour} ${day} * *`,
    timezone,
    description: `monthly on day ${day} at ${display}`,
  }
}

/** A clock's `HH:mm`, in the form `--at` accepts, so the default flows through the same parser. */
function formatTime(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/**
 * Read the minute an `--hourly` schedule should fire on.
 *
 * Accepts the bare minute users reach for first (`:15`, `15`) and the `HH:mm` the other cadences
 * take, where only the minute is meaningful — an hourly schedule has no hour to honour, so an hour
 * that would be silently dropped is refused instead.
 */
function parseHourlyMinute(value: string): number {
  const trimmed = value.trim()
  const bare = /^:?(\d{1,2})$/.exec(trimmed)
  if (bare) {
    const minute = Number(bare[1])
    if (minute > 59) {
      throw new ScheduleExpressionError(
        `Invalid minute "${value}" for --hourly. Use a minute from 0-59, for example :15.`
      )
    }
    return minute
  }

  const { hour, minute } = parseTime(trimmed)
  if (hour !== 0) {
    throw new ScheduleExpressionError(
      `--at "${value}" sets an hour, which --hourly has no use for. Pass the minute alone, for example --at :${String(minute).padStart(2, '0')}.`
    )
  }
  return minute
}

function parseTime(value: string): { hour: number; minute: number; display: string } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) {
    throw new ScheduleExpressionError(`Invalid time "${value}". Use 24-hour HH:mm, for example 09:30.`)
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    throw new ScheduleExpressionError(`Invalid time "${value}". Hour must be 0-23 and minute 0-59.`)
  }
  return { hour, minute, display: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
}

function resolveTimezone(value: string | undefined): string {
  const timezone = value?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
  } catch {
    throw new ScheduleExpressionError(
      `Invalid timezone "${timezone}". Use an IANA timezone such as Europe/London or America/New_York.`
    )
  }
  return timezone
}
