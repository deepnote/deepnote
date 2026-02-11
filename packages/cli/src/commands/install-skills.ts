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
}

// Agent configurations sourced from https://github.com/vercel-labs/skills
const AGENTS: AgentConfig[] = [
  // Non-universal agents (agent-specific project skill dirs)
  {
    name: 'Claude Code',
    projectConfigDir: '.claude',
    projectSkillDir: '.claude/skills',
    globalConfigDir: '.claude',
    globalSkillDir: '.claude/skills',
  },
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
  },
  {
    name: 'Codex',
    projectConfigDir: null,
    projectSkillDir: '.agents/skills',
    globalConfigDir: '.codex',
    globalSkillDir: '.codex/skills',
  },
  {
    name: 'Gemini CLI',
    projectConfigDir: null,
    projectSkillDir: '.agents/skills',
    globalConfigDir: '.gemini',
    globalSkillDir: '.gemini/skills',
  },
  {
    name: 'Amp',
    projectConfigDir: null,
    projectSkillDir: '.agents/skills',
    globalConfigDir: '.config/amp',
    globalSkillDir: '.config/agents/skills',
  },
  {
    name: 'Kimi Code CLI',
    projectConfigDir: null,
    projectSkillDir: '.agents/skills',
    globalConfigDir: '.kimi',
    globalSkillDir: '.config/agents/skills',
  },
  {
    name: 'OpenCode',
    projectConfigDir: null,
    projectSkillDir: '.agents/skills',
    globalConfigDir: '.config/opencode',
    globalSkillDir: '.config/opencode/skills',
  },
]

type InstallStatus = 'installed' | 'updated' | 'up-to-date'

interface InstallResult {
  agent: AgentConfig
  skillPath: string
  status: InstallStatus
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

  const c = getChalk()

  if (options.dryRun) {
    output(c.bold('Dry run — no files written:'))
  } else {
    output(c.bold('Deepnote skill installed for:'))
  }

  for (const result of results) {
    const icon = result.status === 'up-to-date' ? c.dim('=') : c.green('\u2713')
    const statusText =
      result.status === 'up-to-date'
        ? c.dim('(already up to date)')
        : result.status === 'updated'
          ? c.yellow('(updated)')
          : ''
    const line = `  ${icon} ${result.agent.name.padEnd(16)} ${result.skillPath} ${statusText}`
    output(line.trimEnd())
  }
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
    return [AGENTS[0]]
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
