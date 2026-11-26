export function isErrnoENOENT(error: unknown): boolean {
  return typeof error === 'object' && error != null && 'code' in error && error.code === 'ENOENT'
}

export function isErrnoENOTDIR(error: unknown): boolean {
  return typeof error === 'object' && error != null && 'code' in error && error.code === 'ENOTDIR'
}
