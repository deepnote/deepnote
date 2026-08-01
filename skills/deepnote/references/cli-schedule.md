# Schedule Command

Use `deepnote schedule` to create or update recurring notebook runs in Deepnote Cloud:

```bash
deepnote schedule <path> --daily [options]
```

The command configures a cloud schedule; it does not execute the notebook immediately. If the
project is not in Deepnote Cloud, it is created first unless `--no-create` is passed.

## Frequencies

Choose exactly one:

```bash
deepnote schedule report.deepnote --hourly
deepnote schedule report.deepnote --daily --at 09:00
deepnote schedule report.deepnote --weekly Monday --at 08:30
deepnote schedule report.deepnote --monthly 1 --at 06:00
deepnote schedule report.deepnote --cron "0 8 * * 1-5"
```

Friendly daily, weekly, and monthly schedules default to `09:00`. `--timezone` accepts an IANA name
such as `Europe/London`; otherwise the CLI uses the system timezone.

`--hourly` runs at the minute the schedule was created, not at `:00`, so schedules created at
different times spread across the hour instead of all firing on the same execution spike. Pass
`--at :15` (or `--at 15`) to pin a specific minute.

## Options

| Option                  | Meaning                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `--hourly`              | Run every hour, at the creation minute unless `--at` sets one     |
| `--daily`               | Run once per day                                                  |
| `--weekly <day>`        | Run on a weekday (full names and three-letter abbreviations work) |
| `--monthly <day>`       | Run on day 1-31 of each month                                     |
| `--cron <expression>`   | Five-field cron expression                                        |
| `--at <HH:mm>`          | Time for daily, weekly, or monthly schedules; minute for hourly   |
| `--timezone <timezone>` | IANA timezone                                                     |
| `--notebook <name>`     | Select one notebook from a multi-notebook file                    |
| `--token <token>`       | API token; defaults to `DEEPNOTE_TOKEN` or `.env` beside the file |
| `--url <url>`           | API base URL; defaults to `https://api.deepnote.com`              |
| `--no-create`           | Require the notebook to exist in Deepnote Cloud                   |
| `--open`                | Open the scheduled notebook after configuration                   |
| `-o, --output json`     | Machine-readable result                                           |

`--at` is invalid with `--cron`. With `--hourly` it sets the minute, so it takes `:15`, `15`, or an
`HH:mm` whose hour is `00`.

## Cloud Semantics

Deepnote has one scheduled notebook per project. Calling the command again updates the existing
project schedule; selecting another notebook re-points it. Scheduling availability depends on the
workspace plan.

## Output and Exit Codes

Text output includes the frequency, timezone, next run, and cloud URL when available. JSON output
contains `success`, `path`, `notebookId`, `created`, `schedule`, and `url`.

- `0`: schedule created or updated
- `1`: API, network, or other runtime error
- `2`: invalid flags/file/notebook, missing token, authentication failure, or unavailable plan
