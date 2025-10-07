export function convertToEnvironmentVariableName(str: string): string {
  // Environment variable names used by the utilities in the Shell and Utilities volume of IEEE Std 1003.1-2001
  // consist solely of uppercase letters, digits, and the '_' (underscore) from the characters defined in
  // Portable Character Set and do not begin with a digit.
  const notFirstDigit = /^\d/.test(str) ? `_${str}` : str
  const upperCased = notFirstDigit.toUpperCase()

  return upperCased.replace(/[^\w]/g, '_')
}

export function getSqlEnvVarName(integrationId: string): string {
  return `SQL_${integrationId}`
}
