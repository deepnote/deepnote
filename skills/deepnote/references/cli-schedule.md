# Schedule Command

Use `deepnote schedule` to create, update, list, add, or remove recurring notebook runs in Deepnote Cloud:

```bash
deepnote schedule <path> --daily [options]
deepnote schedule <path> --list [options]
deepnote schedule <path> --schedule-id <id> --daily --at 09:00 [options]
deepnote schedule <path> --add --daily --at 18:00 [--name <name>] [-i <key=value>] [options]
deepnote schedule <path> --remove [--schedule-id <id>] [options]
```

The command configures a cloud schedule; it does not execute the notebook immediately. If the
project is not in Deepnote Cloud, it is created first unless `--no-create` is passed. `--list`,
`--schedule-id`, and `--remove` never create anything, and `--add` never creates a project.

## Frequencies

Choose exactly one:

```bash
deepnote schedule report.deepnote --hourly
deepnote schedule report.deepnote --daily --at 09:00
deepnote schedule report.deepnote --weekly Monday --at 08:30
deepnote schedule report.deepnote --monthly 1 --at 06:00
deepnote schedule report.deepnote --cron "0 8 * * 1-5"
```

Without `--at`, every generated schedule fires at the time it was created — the hour and minute for
daily, weekly, and monthly, and the minute for `--hourly`. This matches Deepnote's own scheduling
UI, which defaults new schedules the same way so that runs spread out instead of piling onto the
same execution spike; a fixed default such as `09:00` would be that spike. Pass `--at 09:00` (or
`--at :15` for `--hourly`) to pin a specific time.

`--timezone` accepts an IANA name such as `Europe/London`; otherwise the CLI uses the system
timezone, or with `--schedule-id` the schedule's own.

## Options

| Option                  | Meaning                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `--hourly`              | Run every hour, at the creation minute unless `--at` sets one       |
| `--daily`               | Run once per day                                                    |
| `--weekly <day>`        | Run on a weekday (full names and three-letter abbreviations work)   |
| `--monthly <day>`       | Run on day 1-31 of each month                                       |
| `--cron <expression>`   | Five-field cron expression                                          |
| `--at <HH:mm>`          | Time for daily, weekly, or monthly schedules; minute for hourly     |
| `--timezone <timezone>` | IANA timezone                                                       |
| `--notebook <name>`     | Select one notebook from a multi-notebook file                      |
| `--token <token>`       | API token; defaults to `DEEPNOTE_TOKEN` or `.env` beside the file   |
| `--url <url>`           | API base URL; defaults to `https://api.deepnote.com`                |
| `--no-create`           | Require the notebook to exist in Deepnote Cloud                     |
| `--open`                | Open the scheduled notebook after configuration                     |
| `--remove`              | Remove the notebook's schedule, or the one named by `--schedule-id` |
| `--list`                | List the notebook's schedules and their ids                         |
| `--schedule-id <id>`    | Change or remove one schedule of a notebook that has several        |
| `--add`                 | Add another schedule to the notebook                                |
| `--name <name>`         | Name of the schedule, with `--add` or `--schedule-id`               |
| `-i, --input <key=val>` | Input value, with `--add` or `--schedule-id` (repeatable)           |
| `--clear-inputs`        | Remove the schedule's input values, with `--schedule-id`            |
| `-o, --output json`     | Machine-readable result                                             |

`--at` is invalid with `--cron`. With `--hourly` it sets the minute, so it takes `:15`, `15`, or an
`HH:mm` whose hour is `00`.

## Cloud Semantics

Without `--schedule-id`, the command manages the notebook's schedule. Running it again updates that
schedule; scheduling another notebook adds a schedule rather than moving the existing one. To move a
schedule, schedule the new notebook and `--remove` the old one. Scheduling availability depends on
the workspace plan. Where the workspace allows several schedules per notebook, a notebook can have
more than one; see [Several Schedules](#several-schedules).

The plain command uses `POST /v2/notebooks/{id}/schedule`, which accepts `cron` and `timezone` and
nothing else; `--add` and `--schedule-id` can also set a name and input values. Settings the product
UI exposes, such as republishing the app after a run or auto-pausing a repeatedly failing schedule,
cannot be set through the API, so a CLI-created schedule takes whatever the server defaults them to.

When an existing project has to take the new notebook, Deepnote rejects notebook creation in
`notebook` (single-notebook) and `agent` projects, so the lookup skips those two and creates a fresh
project instead of failing with HTTP 409. A project of any other type — `standard`, a type this CLI
has not heard of, or one the workspace did not report — stays eligible, since refusing what cannot
be read would reintroduce the duplicate projects the lookup exists to prevent.

## Removing a Schedule

```bash
deepnote schedule report.deepnote --remove
deepnote schedule project.deepnote --notebook "Weekly review" --remove
```

`--remove` deletes only the selected notebook's schedule. It never creates anything, works on any
plan, and cannot be combined with flags that set, add, or open a schedule. If there is nothing to
remove, it says so and exits `0`. If several projects share the name and notebook, it fails instead
of guessing.

## Several Schedules

Where the workspace allows several schedules per notebook, the plain command and `--remove` refuse a
notebook that has more than one and exit `1` with:

```text
This notebook has 3 schedules. Use --list to choose one, then pass --schedule-id <id>.
```

Work with one schedule by its id, or add another:

```bash
deepnote schedule report.deepnote --list
deepnote schedule report.deepnote --schedule-id 15 --daily --at 09:00
deepnote schedule report.deepnote --schedule-id 15 --name Morning -i region=US
deepnote schedule report.deepnote --schedule-id 15 --clear-inputs
deepnote schedule report.deepnote --schedule-id 15 --remove
deepnote schedule report.deepnote --add --daily --at 18:00 --name Evening -i region=EU
```

- `--list` shows each schedule's id, name, cron and timezone, next run or `paused (<reason>)`, and
  input names, never input values. It exits `0` when there are no schedules or the notebook is not
  in Deepnote Cloud, and cannot be combined with flags that set, add, open, or remove a schedule.
- `--schedule-id` changes only that schedule. Every frequency except `--cron` needs `--at`, an
  omitted `--timezone` keeps the schedule's own, and a name or input values alone are a change. When
  nothing would change, nothing is sent and the output says `unchanged`; a change resumes a paused
  schedule and makes you its owner. An id that is not one of the notebook's schedules exits `2`, or
  `0` with `--remove`.
- `--add` adds a schedule next to the others, with the same `--at` rule; an omitted `--timezone` uses
  the system timezone. A notebook that is not in Deepnote Cloud exits `2`. When a schedule with the
  same timing, name, and inputs exists, nothing is added, the output says `already exists`, and the
  command exits `0`. Where the workspace allows only one schedule per notebook, a second one exits
  `1` and points to `--schedule-id`.
- `--input` values are typed by the notebook's input blocks, as with `run --input`, and need a
  workspace that allows several schedules per notebook; elsewhere the command exits `2`. With
  `--schedule-id` they are merged into the schedule's own, and `--clear-inputs` removes them. An
  unknown name, a value the block can't take, or an empty `--name` also exits `2`.
- Added schedules don't update the notebook's outputs, and input values stop a schedule from
  updating them; the text output says so. `--clear-inputs` doesn't turn that back on, but you can
  in Deepnote.

`--list`, `--schedule-id`, and `--add` fail rather than guess between projects that share a name, as
`--remove` does.

## Output and Exit Codes

Text output includes the frequency, timezone, next run, and cloud URL when available. JSON output
contains `success`, `path`, `notebookId`, `created`, `schedule`, and `url`.

With `--remove`, with or without `--schedule-id`, JSON output contains `success`, `path`,
`notebookId` (`null` if the notebook is not in Deepnote Cloud), and `removed` (`false` if there was
nothing to remove).

With `--list`, JSON output contains `success`, `path`, `notebookId` (`null` if the notebook is not in
Deepnote Cloud), and `schedules`. Each schedule has `id`, `name`, `cron`, `timezone`, `nextRunAt`,
`isPaused`, `pauseReason`, `updatesNotebook`, `inputNames`, `createdAt`, and `updatedAt`.

With `--schedule-id` and a change, or with `--add`, JSON output contains `success`, `path`,
`notebookId`, `changed` or `added` (`false` when nothing was sent or added), `schedule` (shaped as in
`--list`), and `url`.

- `0`: schedule created, added, updated, unchanged, listed, or removed; nothing to remove; or the
  same schedule already exists for `--add`
- `1`: API, network, or other runtime error, including a notebook with several schedules when
  `--schedule-id` is missing
- `2`: invalid flags/file/notebook/input, missing token, authentication failure, unavailable plan, a
  change for a `--schedule-id` that is not one of the notebook's schedules, or `--add` for a notebook
  that is not in Deepnote Cloud
