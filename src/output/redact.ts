/**
 * Fields that are redacted by default in output.
 * These are sensitive fields that should not be exposed to agents.
 */
const SENSITIVE_FIELDS = new Set([
  'hash',
  'salt',
  'password',
  'resetPasswordToken',
  'resetPasswordExpiration',
  'apiKey',
  'apiKeyIndex',
  '_verificationToken',
  'lockUntil',
  'loginAttempts',
  'secret',
])

/**
 * Recursively redact sensitive fields from an object.
 * Returns a new object with sensitive values replaced by '[REDACTED]'.
 */
export function redact(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data
  }

  if (Array.isArray(data)) {
    return data.map((item) => redact(item))
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_FIELDS.has(key)) {
        result[key] = '[REDACTED]'
      } else {
        result[key] = redact(value)
      }
    }
    return result
  }

  return data
}
