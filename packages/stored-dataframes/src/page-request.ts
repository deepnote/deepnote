import { z } from 'zod'

export const MAX_DATAFRAME_PAGE_SIZE = 1000
export const DEFAULT_DATAFRAME_PAGE_SIZE = 10

/** A page request given as numbers, with both parameters required. */
export const dataframePageRequestSchema = z.object({
  pageIndex: z.int().nonnegative(),
  pageSize: z.int().min(1).max(MAX_DATAFRAME_PAGE_SIZE),
})

export type DataframePageRequest = z.infer<typeof dataframePageRequestSchema>

/** The page parameters of an HTTP query: coerced from strings, defaulted when absent, any other key refused. */
export const dataframePageQuerySchema = z.strictObject({
  pageIndex: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(MAX_DATAFRAME_PAGE_SIZE).default(DEFAULT_DATAFRAME_PAGE_SIZE),
})
