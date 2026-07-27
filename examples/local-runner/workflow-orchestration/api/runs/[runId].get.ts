import { createError, defineEventHandler, getRouterParam } from 'nitro/h3'
import { getRun } from 'workflow/api'

export default defineEventHandler(async event => {
  const runId = getRouterParam(event, 'runId')
  if (!runId) {
    throw createError({ statusCode: 400, statusMessage: 'runId is required' })
  }

  const run = getRun(runId)
  if (!(await run.exists)) {
    throw createError({ statusCode: 404, statusMessage: 'Workflow run not found' })
  }

  const status = await run.status
  if (status === 'failed') {
    try {
      await run.returnValue
    } catch (error) {
      return {
        runId,
        status,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    runId,
    status,
    ...(status === 'completed' ? { result: await run.returnValue } : {}),
  }
})
