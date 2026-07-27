import { defineEventHandler } from 'nitro/h3'
import { start } from 'workflow/api'
import { salesReportWorkflow } from '../workflows/sales-report'

export default defineEventHandler(async ({ req }) => {
  const body = (await req.json().catch(() => ({}))) as { region?: string }
  const run = await start(salesReportWorkflow, [body.region ?? 'All regions'])

  return {
    runId: run.runId,
    message: 'Durable Deepnote pipeline started',
  }
})
