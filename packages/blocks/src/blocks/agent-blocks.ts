import type { AgentBlock, DeepnoteBlock } from '../deepnote-file/deepnote-file-schema'

export function createPythonCodeForAgentBlock(block: AgentBlock): string {
  const prompt = block.content ?? ''
  if (!prompt.trim()) {
    return '# [agent block] (empty prompt)'
  }

  const lines = prompt.split('\n').map(line => `# ${line}`)
  return `# [agent block]\n${lines.join('\n')}`
}

export function isAgentBlock(block: DeepnoteBlock): block is AgentBlock {
  return block.type === 'agent'
}
