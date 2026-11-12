import { type ZodError, z } from 'zod'
import type { components, operations } from './deepnote-cloud-api.generated'
import { HttpError } from './http'

const BooleanQueryParamSchema = z.enum(['true', 'false']).transform(value => value === 'true')

export const ProjectIdSchema = z.uuid().brand<'ProjectId'>()
export type ProjectId = z.output<typeof ProjectIdSchema>

export const ProjectIdParamSchema = z.object({ projectId: ProjectIdSchema })

export const FileReferenceQuerySchema = z.strictObject({
  projectId: ProjectIdSchema,
  path: z.string().min(1),
})

export const CreateFileMultipartFieldsSchema = z.strictObject({
  projectId: ProjectIdSchema,
  path: z.string().min(1),
  overwrite: BooleanQueryParamSchema.optional().default(false),
})

export const CreateProjectBodySchema = z.strictObject({
  name: z.string().min(1),
  folderId: z.uuid().optional(),
  projectType: z.enum(['standard', 'notebook', 'agent', 'data_app', 'streamlit_app']).optional(),
  environmentId: z.uuid().optional(),
})

export const UpdateProjectBodySchema = z
  .strictObject({
    dataApp: z.strictObject({ published: z.boolean() }).optional(),
    environmentId: z.uuid().optional(),
    folderId: z.uuid().nullable().optional(),
  })
  .refine(
    update => update.dataApp !== undefined || update.environmentId !== undefined || update.folderId !== undefined,
    { message: 'At least one project setting must be provided.' }
  )

export const ImportProjectQuerySchema = z.strictObject({
  baseModifiedAt: z.iso.datetime().optional(),
  baseContentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'Must be a 64-character lowercase SHA-256 hex digest.')
    .optional(),
  deleteMissingNotebooks: BooleanQueryParamSchema.optional().default(false),
  force: BooleanQueryParamSchema.optional().default(false),
})

export const CreateStreamlitAppBodySchema = z.strictObject({
  projectId: ProjectIdSchema,
  entrypoint: z.string().min(1),
})

export const ListStreamlitAppsQuerySchema = z.strictObject({ projectId: ProjectIdSchema })

export const StreamlitAppIdParamSchema = z.object({ streamlitAppId: z.uuid() })

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Check<T extends true> = T

type _SchemasMatchOpenApi = [
  Check<
    Same<
      z.input<typeof CreateProjectBodySchema>,
      operations['createProject']['requestBody']['content']['application/json']
    >
  >,
  Check<Same<z.input<typeof ProjectIdParamSchema>, operations['getProject']['parameters']['path']>>,
  Check<Same<z.input<typeof FileReferenceQuerySchema>, operations['downloadFile']['parameters']['query']>>,
  Check<Same<z.input<typeof FileReferenceQuerySchema>, operations['deleteFile']['parameters']['query']>>,
  Check<
    Same<
      z.input<typeof CreateFileMultipartFieldsSchema>,
      Omit<components['schemas']['CreateFileMultipartBody'], 'file'>
    >
  >,
  Check<
    Same<
      z.input<typeof UpdateProjectBodySchema>,
      operations['updateProject']['requestBody']['content']['application/json']
    >
  >,
  Check<
    Same<z.input<typeof ImportProjectQuerySchema>, NonNullable<operations['importProject']['parameters']['query']>>
  >,
  Check<
    Same<
      z.input<typeof CreateStreamlitAppBodySchema>,
      operations['createStreamlitApp']['requestBody']['content']['application/json']
    >
  >,
  Check<Same<z.input<typeof ListStreamlitAppsQuerySchema>, operations['listStreamlitApps']['parameters']['query']>>,
  Check<Same<z.input<typeof StreamlitAppIdParamSchema>, operations['getStreamlitAppStatus']['parameters']['path']>>,
]

/** Parses `input`, throwing a 400 {@link HttpError} that names each invalid field. */
export function parseRequestInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input, {
    error: issue => (issue.code === 'invalid_type' && issue.input === undefined ? 'is required' : undefined),
  })
  if (!result.success) {
    throw new HttpError(400, readableErrors(result.error))
  }
  return result.data
}

function readableErrors(error: ZodError): string {
  return error.issues
    .map(issue => {
      const field = issue.path.map(String).join('.')
      return field ? `${field} ${issue.message.toLowerCase()}` : issue.message
    })
    .join('; ')
}
