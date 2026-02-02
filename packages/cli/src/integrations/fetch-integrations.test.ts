import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../utils/api'
import { type ApiIntegration, apiResponseSchema, fetchIntegrations } from './fetch-integrations'

// Mock the output module to suppress debug logs during tests
vi.mock('../output', () => ({
  debug: vi.fn(),
}))

describe('fetchIntegrations', () => {
  const mockBaseUrl = 'https://api.example.com'
  const mockToken = 'test-token-123'

  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should fetch integrations successfully', async () => {
    const mockIntegrations: ApiIntegration[] = [
      {
        id: 'int-123',
        name: 'My Database',
        type: 'postgresql',
        metadata: { host: 'localhost', port: 5432 },
        is_public: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        federated_auth_method: null,
      },
    ]

    const mockResponse = { integrations: mockIntegrations }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const result = await fetchIntegrations(mockBaseUrl, mockToken)

    expect(result).toEqual(mockIntegrations)
    expect(global.fetch).toHaveBeenCalledWith(`${mockBaseUrl}/v2/integrations`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${mockToken}`,
        'Content-Type': 'application/json',
      },
    })
  })

  it('should throw ApiError with 401 for authentication failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response)

    await expect(fetchIntegrations(mockBaseUrl, mockToken)).rejects.toThrow(ApiError)
    await expect(fetchIntegrations(mockBaseUrl, mockToken)).rejects.toThrow(
      'Authentication failed. Please check your API token.'
    )
  })

  it('should throw ApiError with 403 for access denied', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    } as Response)

    await expect(fetchIntegrations(mockBaseUrl, mockToken)).rejects.toThrow(ApiError)
    await expect(fetchIntegrations(mockBaseUrl, mockToken)).rejects.toThrow(
      'Access denied. You may not have permission to access integrations.'
    )
  })

  it('should throw ApiError for other HTTP errors', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response)

    await expect(fetchIntegrations(mockBaseUrl, mockToken)).rejects.toThrow(ApiError)
    await expect(fetchIntegrations(mockBaseUrl, mockToken)).rejects.toThrow(
      'API request failed with status 500: Internal Server Error'
    )
  })

  it('should throw Error for invalid API response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ invalid: 'response' }),
    } as Response)

    await expect(fetchIntegrations(mockBaseUrl, mockToken)).rejects.toThrow('Invalid API response')
  })

  it('should return empty array when API returns no integrations', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ integrations: [] }),
    } as Response)

    const result = await fetchIntegrations(mockBaseUrl, mockToken)

    expect(result).toEqual([])
  })

  it('should handle multiple integrations', async () => {
    const mockIntegrations: ApiIntegration[] = [
      {
        id: 'int-1',
        name: 'PostgreSQL DB',
        type: 'postgresql',
        metadata: { host: 'localhost' },
        is_public: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        federated_auth_method: null,
      },
      {
        id: 'int-2',
        name: 'MySQL DB',
        type: 'mysql',
        metadata: { host: 'db.example.com' },
        is_public: true,
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        federated_auth_method: 'oauth2',
      },
    ]

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ integrations: mockIntegrations }),
    } as Response)

    const result = await fetchIntegrations(mockBaseUrl, mockToken)

    expect(result).toHaveLength(2)
    expect(result).toEqual(mockIntegrations)
  })
})

describe('apiResponseSchema', () => {
  it('should validate a valid API response', () => {
    const validResponse = {
      integrations: [
        {
          id: 'int-123',
          name: 'Test Integration',
          type: 'postgresql',
          metadata: { host: 'localhost' },
          is_public: false,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          federated_auth_method: null,
        },
      ],
    }

    const result = apiResponseSchema.safeParse(validResponse)
    expect(result.success).toBe(true)
  })

  it('should reject response missing integrations array', () => {
    const invalidResponse = { data: [] }

    const result = apiResponseSchema.safeParse(invalidResponse)
    expect(result.success).toBe(false)
  })

  it('should reject integration missing required fields', () => {
    const invalidResponse = {
      integrations: [
        {
          id: 'int-123',
          // missing name, type, etc.
        },
      ],
    }

    const result = apiResponseSchema.safeParse(invalidResponse)
    expect(result.success).toBe(false)
  })

  it('should accept integration with extra fields in metadata', () => {
    const responseWithExtraMetadata = {
      integrations: [
        {
          id: 'int-123',
          name: 'Test',
          type: 'postgresql',
          metadata: {
            host: 'localhost',
            port: 5432,
            customField: 'custom value',
            nested: { deep: 'value' },
          },
          is_public: false,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          federated_auth_method: null,
        },
      ],
    }

    const result = apiResponseSchema.safeParse(responseWithExtraMetadata)
    expect(result.success).toBe(true)
  })

  it('should preserve extra fields on integration objects (passthrough)', () => {
    const responseWithExtraIntegrationFields = {
      integrations: [
        {
          id: 'int-123',
          name: 'Test',
          type: 'postgresql',
          metadata: { host: 'localhost' },
          is_public: false,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          federated_auth_method: null,
          // Extra fields that should be preserved
          extra_field: 'extra value',
          another_field: 123,
        },
      ],
    }

    const result = apiResponseSchema.safeParse(responseWithExtraIntegrationFields)
    expect(result.success).toBe(true)
    assert(result.success)
    expect(result.data.integrations[0]).toHaveProperty('extra_field', 'extra value')
    expect(result.data.integrations[0]).toHaveProperty('another_field', 123)
  })

  it('should preserve extra fields on response object (passthrough)', () => {
    const responseWithExtraFields = {
      integrations: [
        {
          id: 'int-123',
          name: 'Test',
          type: 'postgresql',
          metadata: { host: 'localhost' },
          is_public: false,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          federated_auth_method: null,
        },
      ],
      // Extra fields on the response that should be preserved
      total_count: 1,
      pagination: { page: 1, per_page: 10 },
    }

    const result = apiResponseSchema.safeParse(responseWithExtraFields)
    expect(result.success).toBe(true)
    assert(result.success)
    expect(result.data).toHaveProperty('total_count', 1)
    expect(result.data).toHaveProperty('pagination', { page: 1, per_page: 10 })
  })
})
