import { createError, defineEventHandler } from 'nitro/h3'
import { start } from 'workflow/api'
import { parseSalesDecisionRequest, type SalesDecisionRequest, salesDecisionWorkflow } from '../workflows/sales-report'

export default defineEventHandler(async ({ req }) => {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
  }

  let body: SalesDecisionRequest
  try {
    body = parseSalesDecisionRequest(parsed)
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Invalid request body',
    })
  }
  const run = await start(salesDecisionWorkflow, [body])

  return {
    runId: run.runId,
    statusUrl: `/api/runs/${run.runId}`,
    message: 'Durable regional sales decision started',
  }
})
