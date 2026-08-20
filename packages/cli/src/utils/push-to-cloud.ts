import type { DeepnoteFile } from '@deepnote/blocks'
import {
  planNotebookSync,
  type SyncChange,
  type SyncPlan,
  type SyncResult,
  syncNotebookContent,
} from '@deepnote/local-runner'
import ora from 'ora'
import { debug, getChalk, getOutputConfig, log, warn } from '../output'
import { CloudRunUsageError } from './cloud-run-errors'
import { promptForBooleanField } from './inquirer'

/**
 * `deepnote run --cloud --push`: send the local file's blocks to the Deepnote notebook before
 * running it, so the run executes what is on disk rather than what was last saved in Deepnote.
 *
 * This is destructive — a block Deepnote has that the file does not is deleted — so the default is
 * to show what will change and ask. `--yes` skips the question for CI; `--dry-run` prints the plan
 * and stops before sending anything.
 */

export interface PushOutcome {
  /** False when nothing needed sending, the user declined, or this was a dry run. */
  applied: boolean
  /** True when the user was asked and said no. The caller should stop without running. */
  declined: boolean
  /** True when `--dry-run` stopped this before any request. The caller should stop without running. */
  previewed: boolean
  /** The computed plan, for callers that render their own preview (e.g. machine output). */
  plan?: SyncPlan
  result?: SyncResult
}

/** Human-readable one-liner for a planned change, e.g. `update  code    b1  (content changed)`. */
function describeChange(change: SyncChange): string {
  const chalk = getChalk()
  const verb =
    change.action === 'delete'
      ? chalk.red('delete')
      : change.action === 'create'
        ? chalk.green('create')
        : chalk.yellow('update')
  return `  ${verb} ${change.blockType.padEnd(16)} ${change.blockId}  ${chalk.dim(`(${change.reason})`)}`
}

/** Prints the plan the way someone about to approve a destructive change needs to read it. */
function printPlan(plan: SyncPlan, notebookId: string): void {
  const chalk = getChalk()
  const counts = {
    create: plan.changes.filter(c => c.action === 'create').length,
    update: plan.changes.filter(c => c.action === 'update').length,
    delete: plan.changes.filter(c => c.action === 'delete').length,
  }

  log(`\nPushing to Deepnote notebook ${chalk.bold(notebookId)}:`)
  for (const change of plan.changes) {
    log(describeChange(change))
  }
  if (plan.moves.length > 0) {
    log(`  ${chalk.cyan('reorder')} ${plan.moves.length} ${plan.moves.length === 1 ? 'block' : 'blocks'}`)
  }
  for (const warning of plan.warnings) {
    log(chalk.yellow(`  ! ${warning}`))
  }

  const summary = [
    counts.create ? `${counts.create} to create` : undefined,
    counts.update ? `${counts.update} to update` : undefined,
    counts.delete ? chalk.red(`${counts.delete} to delete`) : undefined,
    plan.moves.length ? `${plan.moves.length} to move` : undefined,
  ].filter(Boolean)
  log(`\n${summary.join(', ')}.`)
}

export interface PushArgs {
  file: DeepnoteFile
  /** The notebook of the local file whose blocks are being pushed. */
  localNotebookId: string
  /** The Deepnote notebook to push into. */
  notebookId: string
  baseUrl: string
  token: string
  /** Skip the confirmation prompt. */
  yes?: boolean
  /** Print the plan and stop, sending nothing. */
  dryRun?: boolean
  /** True when output is machine-readable, so nothing may be printed and nothing may be prompted. */
  machineOutput?: boolean
}

/**
 * Plan the push, confirm it, and apply it.
 *
 * The plan is computed once and applied as computed — the user approves the same set of changes
 * that gets sent, not a second opinion about them.
 */
export async function pushLocalNotebook(args: PushArgs): Promise<PushOutcome> {
  const { file, localNotebookId, notebookId, baseUrl, token } = args
  const chalk = getChalk()

  const planned = await planNotebookSync(file, localNotebookId, notebookId, {
    token,
    baseUrl,
    dryRun: true,
  })

  if (planned.isEmpty) {
    debug(`Notebook ${notebookId} already matches the local file; nothing to push.`)
    if (!args.machineOutput && !getOutputConfig().quiet) {
      log(chalk.dim('Deepnote already matches this file — nothing to push.'))
    }
    // Under --dry-run an empty plan still counts as previewed: the caller must not run either.
    return { applied: false, declined: false, previewed: args.dryRun === true, plan: planned }
  }

  if (args.machineOutput) {
    // printPlan is where warnings are shown, and machine output skips it — but a warning like a
    // dropped SQL integration must not vanish just because the caller wanted JSON. stderr keeps
    // stdout machine-readable. The dry-run preview additionally carries them in its JSON payload.
    for (const warning of planned.warnings) {
      warn(`push warning: ${warning}`)
    }
  } else {
    printPlan(planned, notebookId)
  }

  if (args.dryRun) {
    if (!args.machineOutput) {
      log(chalk.dim('\n--dry-run: nothing was sent, and the notebook was not run.'))
    }
    return { applied: false, declined: false, previewed: true, plan: planned }
  }

  if (!args.yes) {
    // Nothing to prompt with when output is piped or machine-readable: hanging on a question nobody
    // can see is worse than refusing, and silently pushing without asking is worse than either.
    if (args.machineOutput || !process.stdin.isTTY || !process.stdout.isTTY) {
      // A usage error, not a runtime one: this is a bad invocation for the environment it ran in,
      // and it should exit 2 like every other misuse rather than reading as a failed run.
      throw new CloudRunUsageError(
        '--push deletes blocks in Deepnote that this file does not have, so it needs confirmation. ' +
          'Re-run in a terminal, or pass --yes to confirm non-interactively.'
      )
    }
    const confirmed = await promptForBooleanField({
      label: 'Push these changes to Deepnote?',
      defaultValue: false,
    })
    if (!confirmed) {
      log(chalk.dim('Aborted; nothing was sent.'))
      return { applied: false, declined: true, previewed: false, plan: planned }
    }
  }

  const total = planned.changes.length + planned.moves.length
  const useSpinner = !args.machineOutput && !getOutputConfig().quiet && process.stderr.isTTY
  const spinner = useSpinner ? ora(`Pushing ${total} ${total === 1 ? 'change' : 'changes'}…`).start() : null

  let result: SyncResult
  try {
    result = await syncNotebookContent(file, localNotebookId, notebookId, {
      token,
      baseUrl,
      plan: planned,
      onProgress: (done, count) => {
        if (spinner) {
          spinner.text = `Pushing change ${done + 1} of ${count}…`
        }
      },
    })
  } catch (err) {
    spinner?.fail('Push failed')
    throw err
  }

  spinner?.succeed(
    `Pushed: ${result.created.length} created, ${result.updated.length} updated, ` +
      `${result.deleted.length} deleted, ${result.movesApplied} moved.`
  )
  return { applied: true, declined: false, previewed: false, plan: planned, result }
}
