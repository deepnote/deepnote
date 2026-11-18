import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Command } from 'commander'

import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output } from '../output'
import { getSkillDir } from '../skill/skill-files'

export interface InstallSkillsOptions {
  agent?: string
  dryRun?: boolean
  global?: boolean
}

interface AgentConfig {
  name: string
  /** Directory to check for project-level detection (relative to project root). Null = not auto-detectable in project mode. */
  projectConfigDir: string | null
  /** Skills install directory in project mode (relative to project root). */
  projectSkillDir: string
  /** Directory to check for global-level detection (relative to home). Null = not auto-detectable globally. */
  globalConfigDir: string | null
  /** Skills install directory in global mode (relative to home). Null = global not supported. */
  globalSkillDir: string | null
  /**
   * Instructions file that points the agent at the installed skill (relative to project root).
   * Only for agents that do not discover `SKILL.md` on their own. Null = discovery is automatic.
   */
  projectInstructionsFile?: string | null
  /** Instructions file in global mode (relative to home). Null = no pointer is written. */
  globalInstructionsFile?: string | null
}

// Agent configurations sourced from https://github.com/vercel-labs/skills
const CLAUDE_CODE: AgentConfig = {
  name: 'Claude Code',
  projectConfigDir: '.claude',
  projectSkillDir: '.claude/skills',
  globalConfigDir: '.claude',
  globalSkillDir: '.claude/skills',
}

const AGENTS: AgentConfig[] = [
  // Non-universal agents (agent-specific project skill dirs)
  CLAUDE_CODE,
  {
    name: 'Cursor',
    projectConfigDir: '.cursor',
    projectSkillDir: '.cursor/skills',
    globalConfigDir: '.cursor',
    globalSkillDir: '.cursor/skills',
  },
  {
    name: 'Windsurf',
    projectConfigDir: '.windsurf',
    projectSkillDir: '.windsurf/skills',
    globalConfigDir: '.codeium/windsurf',
    globalSkillDir: '.codeium/windsurf/skills',
  },
  {
    name: 'Cline',
    projectConfigDir: '.cline',
    projectSkillDir: '.cline/skills',
    globalConfigDir: '.cline',
    globalSkillDir: '.cline/skills',
  },
  {
    name: 'Roo Code',
    projectConfigDir: '.roo',
    projectSkillDir: '.roo/skills',
    globalConfigDir: '.roo',
    globalSkillDir: '.roo/skills',
  },
  {
    name: 'Augment',
    projectConfigDir: '.augment',
    projectSkillDir: '.augment/skills',
    globalConfigDir: '.augment',
    globalSkillDir: '.augment/skills',
  },
  {
    name: 'Continue',
    projectConfigDir: '.continue',
    projectSkillDir: '.continue/skills',
    globalConfigDir: '.continue',
    globalSkillDir: '.continue/skills',
  },
  {
    name: 'Antigravity',
    projectConfigDir: '.agent',
    projectSkillDir: '.agent/skills',
    globalConfigDir: '.gemini/antigravity',
    globalSkillDir: '.gemini/antigravity/skills',
  },
  {
    name: 'Trae',
    projectConfigDir: '.trae',
    projectSkillDir: '.trae/skills',
    globalConfigDir: '.trae',
    globalSkillDir: '.trae/skills',
  },
  {
    name: 'Goose',
    projectConfigDir: '.goose',
    projectSkillDir: '.goose/skills',
    globalConfigDir: '.config/goose',
    globalSkillDir: '.config/goose/skills',
  },
  {
    name: 'Junie',
    projectConfigDir: '.junie',
    projectSkillDir: '.junie/skills',
    globalConfigDir: '.junie',
    globalSkillDir: '.junie/skills',
  },
  {
    name: 'Kilo Code',
    projectConfigDir: '.kilocode',
    projectSkillDir: '.kilocode/skills',
    globalConfigDir: '.kilocode',
    globalSkillDir: '.kilocode/skills',
  },
  {
    name: 'Kiro',
    projectConfigDir: '.kiro',
    projectSkillDir: '.kiro/skills',
    globalConfigDir: '.kiro',
    globalSkillDir: '.kiro/skills',
  },
  // Universal agents (share .agents/skills in project mode)
  {
    name: 'GitHub Copilot',
    projectConfigDir: '.github',
    projectSkillDir: '.agents/skills',
    globalConfigDir: '.copilot',
    globalSkillDir: '.copilot/skills',
    projectInstructionsFile: '.github/copilot-instructions.md',
    globalInstructionsFile: null,
  },
  {
    name: 'Codex',
    projectConfigDir: null,
    projectSkillDir: '.agents/skills',
    globalConfigDir: '.codex',
    globalSkillDir: '.codex/skills',
    projectInstructionsFile: 'AGENTS.md',
    globalInstructionsFile: '.codex/AGENTS.md',
  },
  {
    name: 'Gemini CLI',
    projectConfigDir: null,
    projectSkillDir: '.agents/skills',
    globalConfigDir: '.gemini',
    globalSkillDir: '.gemini/skills',
    projectInstructionsFile: 'GEMINI.md',
    globalInstructionsFile: '.gemini/GEMINI.md',
  },
  {
    name: 'Amp',
    projectConfigDir: null,
    projectSkillDir: '.agents/skills',
    globalConfigDir: '.config/amp',
    globalSkillDir: '.config/agents/skills',
    projectInstructionsFile: 'AGENTS.md',
    globalInstructionsFile: '.config/AGENTS.md',
  },
  {
    name: 'Kimi Code CLI',
    projectConfigDir: null,
    projectSkillDir: '.agents/skills',
    globalConfigDir: '.kimi',
    globalSkillDir: '.config/agents/skills',
    projectInstructionsFile: 'AGENTS.md',
    globalInstructionsFile: '.config/AGENTS.md',
  },
  {
    name: 'OpenCode',
    projectConfigDir: null,
    projectSkillDir: '.agents/skills',
    globalConfigDir: '.config/opencode',
    globalSkillDir: '.config/opencode/skills',
    projectInstructionsFile: 'AGENTS.md',
    globalInstructionsFile: '.config/opencode/AGENTS.md',
  },
]

type InstallStatus = 'installed' | 'updated' | 'up-to-date'

interface InstallResult {
  agent: AgentConfig
  skillPath: string
  status: InstallStatus
}

/** `conflict`: the file has markers we cannot pair safely, so it is left untouched. */
type PointerStatus = InstallStatus | 'conflict'

interface PointerResult {
  agents: string[]
  file: string
  status: PointerStatus
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

const POINTER_START = '<!-- BEGIN DEEPNOTE SKILL -->'
const POINTER_END = '<!-- END DEEPNOTE SKILL -->'

/**
 * Agents that discover `SKILL.md` on their own need nothing more than the copied files. The rest
 * read a single instructions file, so point that file at the skill or the agent never opens it.
 */
function renderPointer(skillDir: string): string {
  const skillPath = path.posix.join(skillDir, 'SKILL.md')
  const referencesDir = path.posix.join(skillDir, 'references')

  return [
    POINTER_START,
    '## Deepnote skill',
    '',
    `Read \`${skillPath}\` before working with \`.deepnote\` files, the Deepnote CLI, or Deepnote`,
    'data apps and Streamlit apps. It links to task-specific references in',
    `\`${referencesDir}/\`; open the ones the task needs. Building or publishing an app needs`,
    `\`${referencesDir}/apps.md\` and \`${referencesDir}/cli-publish.md\`.`,
    '',
    'This block is managed by `deepnote install-skills`. Edits inside it are overwritten.',
    POINTER_END,
  ].join('\n')
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * Replaces the managed block, or appends it, leaving the rest of the file untouched.
 *
 * Anything other than "no markers" or "exactly one well-formed pair" is a conflict: pairing a
 * hand-edited marker with one of ours would delete the instructions between them.
 */
function upsertPointer(existing: string | null, block: string): { content: string | null; status: PointerStatus } {
  if (existing === null) {
    return { content: `${block}\n`, status: 'installed' }
  }

  const starts = countOccurrences(existing, POINTER_START)
  const ends = countOccurrences(existing, POINTER_END)

  if (starts === 0 && ends === 0) {
    const separator = existing.length === 0 || existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
    return { content: `${existing}${separator}${block}\n`, status: 'installed' }
  }

  const start = existing.indexOf(POINTER_START)
  const end = existing.indexOf(POINTER_END)

  if (starts !== 1 || ends !== 1 || end < start) {
    return { content: null, status: 'conflict' }
  }

  const content = existing.slice(0, start) + block + existing.slice(end + POINTER_END.length)
  return { content, status: content === existing ? 'up-to-date' : 'updated' }
}

/** Returns null only for a file that is not there; any other read failure is a real error. */
async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function installPointers(
  baseDir: string,
  isGlobal: boolean,
  agents: AgentConfig[],
  dryRun: boolean
): Promise<PointerResult[]> {
  const results = new Map<string, PointerResult>()

  for (const agent of agents) {
    const instructionsFile = isGlobal ? agent.globalInstructionsFile : agent.projectInstructionsFile
    const agentSkillDir = isGlobal ? agent.globalSkillDir : agent.projectSkillDir
    if (!instructionsFile || !agentSkillDir) {
      continue
    }

    const existingResult = results.get(instructionsFile)
    if (existingResult) {
      existingResult.agents.push(agent.name)
      continue
    }

    const filePath = path.join(baseDir, instructionsFile)
    // A global instructions file is read from any project, so a relative skill path would resolve
    // against whichever project the agent is in.
    const skillDirRef = isGlobal
      ? toPosix(path.join(baseDir, agentSkillDir, 'deepnote'))
      : toPosix(path.join(agentSkillDir, 'deepnote'))
    const existing = await readFileIfExists(filePath)
    const { content, status } = upsertPointer(existing, renderPointer(skillDirRef))

    if (!dryRun && content !== null && status !== 'up-to-date') {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, 'utf8')
    }

    results.set(instructionsFile, { agents: [agent.name], file: instructionsFile, status })
  }

  return [...results.values()]
}

export function createInstallSkillsAction(_program: Command): (options: InstallSkillsOptions) => Promise<void> {
  return async options => {
    try {
      debug(`Options: ${JSON.stringify(options)}`)
      await installSkills(options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logError(message)
      process.exit(ExitCode.Error)
    }
  }
}

async function installSkills(options: InstallSkillsOptions): Promise<void> {
  const isGlobal = !!options.global
  const baseDir = isGlobal ? os.homedir() : process.cwd()
  const skillDir = getSkillDir()

  debug(`Base directory: ${baseDir}`)
  debug(`Skill source: ${skillDir}`)
  debug(`Mode: ${isGlobal ? 'global' : 'project'}`)

  try {
    await fs.access(skillDir)
  } catch {
    throw new Error(`Skill source directory not found: ${skillDir}`)
  }

  const agents = await detectAgents(baseDir, isGlobal, options.agent)

  if (agents.length === 0) {
    logError('No agents detected. Use --agent to specify one.')
    process.exit(ExitCode.InvalidUsage)
  }

  // Read all files from the skill directory recursively
  const skillContents = await readDirRecursive(skillDir)

  const results: InstallResult[] = []
  const installedDirs = new Set<string>()

  for (const agent of agents) {
    const agentSkillDir = isGlobal ? agent.globalSkillDir : agent.projectSkillDir
    if (!agentSkillDir) {
      continue
    }
    const targetDir = path.join(baseDir, agentSkillDir, 'deepnote')

    // Deduplicate: universal agents share the same project skill directory
    if (installedDirs.has(targetDir)) {
      continue
    }
    installedDirs.add(targetDir)

    const skillPath = path.join(agentSkillDir, 'deepnote', 'SKILL.md')

    if (options.dryRun) {
      const status = await getInstallStatus(targetDir, skillContents)
      results.push({ agent, status, skillPath })
      continue
    }

    const status = await installSkillFiles(targetDir, skillContents)
    results.push({ agent, status, skillPath })
  }

  const pointers = await installPointers(baseDir, isGlobal, agents, !!options.dryRun)

  const c = getChalk()

  if (options.dryRun) {
    output(c.bold('Dry run — no files written:'))
  } else {
    output(c.bold('Deepnote skill installed for:'))
  }

  const maxNameLen = Math.max(...results.map(r => r.agent.name.length))

  for (const result of results) {
    const icon = result.status === 'up-to-date' ? c.dim('=') : c.green('\u2713')
    const line = `  ${icon} ${result.agent.name.padEnd(maxNameLen + 2)} ${result.skillPath} ${formatStatus(result.status, c)}`
    output(line.trimEnd())
  }

  if (pointers.length === 0) {
    return
  }

  output('')
  output(c.bold('Skill pointer written to agent instructions:'))

  for (const pointer of pointers) {
    const icon =
      pointer.status === 'conflict' ? c.yellow('!') : pointer.status === 'up-to-date' ? c.dim('=') : c.green('\u2713')
    const agents = c.dim(`(${pointer.agents.join(', ')})`)
    output(`  ${icon} ${pointer.file} ${agents} ${formatStatus(pointer.status, c)}`.trimEnd())
  }

  if (pointers.some(pointer => pointer.status === 'conflict')) {
    output('')
    output(
      c.yellow(
        `Left unchanged: remove the stray ${POINTER_START} or ${POINTER_END} marker from the file, then install again.`
      )
    )
  }
}

function formatStatus(status: PointerStatus, c: ReturnType<typeof getChalk>): string {
  if (status === 'conflict') {
    return c.yellow('(unpaired skill markers — not written)')
  }
  if (status === 'up-to-date') {
    return c.dim('(already up to date)')
  }
  return status === 'updated' ? c.yellow('(updated)') : ''
}

/** Recursively reads all files in a directory, returning a map of relative paths to contents. */
async function readDirRecursive(baseDir: string, prefix = ''): Promise<Map<string, string>> {
  const contents = new Map<string, string>()
  const entries = await fs.readdir(path.join(baseDir, prefix), { withFileTypes: true })

  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name)
    if (entry.isDirectory()) {
      const sub = await readDirRecursive(baseDir, relativePath)
      for (const [key, value] of sub) {
        contents.set(key, value)
      }
    } else {
      contents.set(relativePath, await fs.readFile(path.join(baseDir, relativePath), 'utf8'))
    }
  }

  return contents
}

async function detectAgents(baseDir: string, isGlobal: boolean, agentFilter?: string): Promise<AgentConfig[]> {
  if (agentFilter) {
    const normalized = agentFilter.toLowerCase().replace(/[\s-]+/g, '')
    const agent = AGENTS.find(a => a.name.toLowerCase().replace(/[\s-]+/g, '') === normalized)
    if (!agent) {
      const valid = AGENTS.map(a => a.name).join(', ')
      throw new Error(`Unknown agent: ${agentFilter}. Valid agents: ${valid}`)
    }
    if (isGlobal && !agent.globalSkillDir) {
      throw new Error(`Agent "${agent.name}" does not support global installation.`)
    }
    return [agent]
  }

  // Detect which agents have config directories
  const detected: AgentConfig[] = []
  for (const agent of AGENTS) {
    const configDir = isGlobal ? agent.globalConfigDir : agent.projectConfigDir
    if (!configDir) {
      continue
    }
    if (isGlobal && !agent.globalSkillDir) {
      continue
    }

    const configPath = path.join(baseDir, configDir)
    try {
      const stat = await fs.stat(configPath)
      if (stat.isDirectory()) {
        detected.push(agent)
      }
    } catch {
      // Directory doesn't exist
    }
  }

  // Default to Claude Code if none detected
  if (detected.length === 0) {
    return [CLAUDE_CODE]
  }

  return detected
}

async function getInstallStatus(targetDir: string, skillContents: Map<string, string>): Promise<InstallStatus> {
  try {
    await fs.access(targetDir)
  } catch {
    return 'installed'
  }

  for (const [file, content] of skillContents) {
    const targetPath = path.join(targetDir, file)
    try {
      const existing = await fs.readFile(targetPath, 'utf8')
      if (existing !== content) {
        return 'updated'
      }
    } catch {
      return 'installed'
    }
  }

  return 'up-to-date'
}

async function installSkillFiles(targetDir: string, skillContents: Map<string, string>): Promise<InstallStatus> {
  const status = await getInstallStatus(targetDir, skillContents)

  if (status === 'up-to-date') {
    return status
  }

  for (const [file, content] of skillContents) {
    const targetPath = path.join(targetDir, file)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, content, 'utf8')
  }

  return status
}
