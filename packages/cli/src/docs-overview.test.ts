import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProgram } from './cli'

// docs/deepnote-cli.md is the CLI overview page published at
// https://deepnote.com/docs/deepnote-cli. Its command table is written by hand,
// so this test keeps the inventory in step with the commands commander
// actually registers: adding, removing or renaming a command (or a
// subcommand) without touching the page fails here.
const docsPath = path.join(__dirname, '../../../docs/deepnote-cli.md')

function readCommandTableRows(): string[] {
  const markdown = fs.readFileSync(docsPath, 'utf8')
  const commandsSection = markdown.split('\n## Commands\n')[1]?.split('\n## ')[0]
  expect(commandsSection, 'docs/deepnote-cli.md must have a "## Commands" section').toBeDefined()
  return (commandsSection ?? '').split('\n').filter(line => line.startsWith('| ') && line.includes('`deepnote '))
}

function documentedCommandName(row: string): string {
  const match = row.match(/`deepnote ([a-z-]+)/)
  expect(match, `cannot find a command name in table row: ${row}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('docs/deepnote-cli.md command table', () => {
  const program = createProgram()
  const rows = readCommandTableRows()

  it('lists exactly the commands the CLI registers', () => {
    const documented = rows.map(documentedCommandName).sort()
    const registered = program.commands.map(command => command.name()).sort()

    expect(documented).toEqual(registered)
  })

  it('names every subcommand in its parent row', () => {
    for (const command of program.commands) {
      if (command.commands.length === 0) {
        continue
      }

      const row = rows.find(candidate => documentedCommandName(candidate) === command.name())
      expect(row, `no table row for "deepnote ${command.name()}"`).toBeDefined()

      for (const subcommand of command.commands) {
        expect(row, `row for "deepnote ${command.name()}" must mention "${subcommand.name()}"`).toContain(
          subcommand.name()
        )
      }
    }
  })
})
