/** see https://www.python.org/dev/peps/pep-0249/#paramstyle */
export type ParamStyle = 'pyformat' | 'qmark' | 'numeric' | 'named' | 'format'

export interface SqlAlchemyInput {
  url: string
  params: Record<string, unknown>
  param_style: ParamStyle
  ssh_options?: {
    enabled?: boolean | undefined
    host?: string | undefined
    port?: string | undefined
    user?: string | undefined
  }
  sslParams?: {
    caCertificateText: string
    caCertificateName: string
  }
  iamParams?: {
    integrationId: string
    type: string
  }
}
