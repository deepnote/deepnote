import { z } from 'zod'

/**
 * Schema for a single federated auth token entry.
 * Stored in ~/.deepnote/federated-auth-tokens.yaml.
 *
 * No duplication with .deepnote.env.yaml - only OAuth token data.
 * Integration config (tokenUrl, clientId, etc.) is read from integrations file.
 */
export const federatedAuthTokenEntrySchema = z.object({
  integrationId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime().optional(),
})

export type FederatedAuthTokenEntry = z.infer<typeof federatedAuthTokenEntrySchema>

/**
 * Loose schema for the tokens file structure.
 * Allows per-entry validation to report specific issues.
 */
export const baseTokensFileSchema = z.object({
  tokens: z.array(z.record(z.unknown())).optional().default([]),
})

export type BaseTokensFile = z.infer<typeof baseTokensFileSchema>

/**
 * Strict schema for a fully validated tokens file.
 */
export const tokensFileSchema = z.object({
  tokens: z.array(federatedAuthTokenEntrySchema),
})

export type TokensFile = z.infer<typeof tokensFileSchema>
