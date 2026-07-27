import type { OrchestrationStepResult } from '@deepnote/local-runner'
import { runNotebookStep } from './deepnote'

const INPUTS_NOTEBOOK = '../../6_with_inputs.deepnote'
const REPORT_NOTEBOOK = '../../local-runner-showcase.deepnote'

export async function salesReportWorkflow(region: string) {
  'use workflow'

  // Keep the first two runs sequential: on a brand-new account the first run may create the cloud
  // notebook, and this avoids racing a second create for the same file.
  const first = await runNotebookStep({
    id: 'prepare-first',
    notebook: INPUTS_NOTEBOOK,
    target: 'cloud',
    inputs: { greeting: `${region} source A ready`, count: 6, enabled: true },
  })
  const second = await runNotebookStep({
    id: 'prepare-second',
    notebook: INPUTS_NOTEBOOK,
    target: 'cloud',
    inputs: { greeting: `${region} source B ready`, count: 9, enabled: true },
  })

  const analystNotes = [streamText(first), streamText(second)].join('; ')

  const report = await runNotebookStep({
    id: 'agent-report',
    notebook: REPORT_NOTEBOOK,
    target: 'cloud',
    inputs: {
      report_title: 'Durable orchestrated sales review',
      region,
      trailing_months: 6,
      analyst_notes: analystNotes,
    },
    allowFailure: true,
  })

  return {
    reportSucceeded: report.success,
    executiveReadout: report.success ? lastAgentOutput(report) : null,
    error: report.error,
  }
}

function streamText(result: OrchestrationStepResult): string {
  return result.outputs
    .flatMap(block => block.outputs)
    .filter(output => output.output_type === 'stream')
    .map(output => (Array.isArray(output.text) ? output.text.join('') : output.text))
    .join('')
    .trim()
}

function lastAgentOutput(result: OrchestrationStepResult): string {
  const blocks = result.snapshot?.notebooks.flatMap(notebook => notebook.blocks) ?? []
  const agentIndex = blocks.map(block => block.type).lastIndexOf('agent')
  if (agentIndex === -1) {
    throw new Error(`Step "${result.id}" has no agent output.`)
  }

  const directOutput = streamOutputs(blocks[agentIndex].outputs)
  if (directOutput) {
    return directOutput
  }

  // Cloud agent runs append generated blocks; their original agent block can have no output.
  const generatedMarkdown = blocks
    .slice(agentIndex + 1)
    .filter(block => block.type === 'markdown' && block.content.trim())
    .at(-1)
  if (generatedMarkdown) {
    return generatedMarkdown.content
  }

  throw new Error(`Step "${result.id}" has no textual agent output.`)
}

function streamOutputs(outputs: OrchestrationStepResult['outputs'][number]['outputs']): string {
  return outputs
    .filter(output => output.output_type === 'stream')
    .map(output => (Array.isArray(output.text) ? output.text.join('') : output.text))
    .join('')
}
