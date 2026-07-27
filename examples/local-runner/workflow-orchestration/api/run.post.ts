import { defineEventHandler } from 'nitro/h3'
import { start } from 'workflow/api'
import { type SalesDecisionRequest, salesDecisionWorkflow } from '../workflows/sales-report'

export default defineEventHandler(async ({ req }) => {
  const body = (await req.json().catch(() => ({}))) as SalesDecisionRequest
  const run = await start(salesDecisionWorkflow, [body])

  return {
    runId: run.runId,
    statusUrl: `/api/runs/${run.runId}`,
    message: 'Durable regional sales decision started',
  }
})
