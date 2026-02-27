import { confirm, input, number, password } from '@inquirer/prompts'
import z from 'zod'

export type StringFieldCustomValidateFn = (value: string) => string | true

export function stringPortValidate(value: string): string | true {
  // Allow empty string — optional port fields skip validation when left blank
  if (!value.trim()) {
    return true
  }
  const port = z.coerce.number().safeParse(value)
  if (!port.success) {
    return 'Invalid value, expected a number'
  }
  if (port.data < 1 || port.data > 65535) {
    return 'Port must be between 1 and 65535'
  }
  return true
}

export async function promptForStringField({
  label,
  defaultValue,
  customValidate,
  secret,
  required,
}: {
  label: string
  defaultValue?: string
  customValidate?: StringFieldCustomValidateFn
  secret: boolean
  required: boolean
}): Promise<string> {
  if (secret) {
    // The password prompt does not support `default` values (input is masked),
    // so we allow empty submission when a defaultValue exists and fall back to it.
    const hasDefault = defaultValue != null
    const result = await password({
      message: label,
      validate: (value: string) => {
        if (required && !value.trim() && !hasDefault) {
          return `${label} is required`
        }
        if (value.trim() && customValidate) {
          const customValidateResult = customValidate(value)
          if (typeof customValidateResult === 'string') {
            return customValidateResult
          }
        }
        return true
      },
    })
    if (hasDefault && !result.trim()) {
      return defaultValue
    }
    return result
  }

  return input({
    message: label,
    default: defaultValue,
    required: required === true,
    validate: (value: string) => {
      if (required && !value.trim()) {
        return `${label} is required`
      }
      if (customValidate) {
        const customValidateResult = customValidate(value)
        if (typeof customValidateResult === 'string') {
          return customValidateResult
        }
      }
      return true
    },
  })
}

export async function promptForRequiredStringField({
  label,
  defaultValue,
  customValidate,
}: {
  label: string
  defaultValue?: string
  customValidate?: StringFieldCustomValidateFn
}): Promise<string> {
  return promptForStringField({ label, secret: false, required: true, defaultValue, customValidate })
}

export async function promptForOptionalStringField({
  label,
  defaultValue,
  customValidate,
}: {
  label: string
  defaultValue?: string
  customValidate?: StringFieldCustomValidateFn
}): Promise<string> {
  return promptForStringField({ label, secret: false, required: false, defaultValue, customValidate })
}

export async function promptForRequiredStringPortField({
  label,
  defaultValue,
}: {
  label: string
  defaultValue?: string
}): Promise<string> {
  return promptForStringField({
    label,
    secret: false,
    required: true,
    defaultValue,
    customValidate: stringPortValidate,
  })
}

export async function promptForOptionalStringPortField({
  label,
  defaultValue,
}: {
  label: string
  defaultValue?: string
}): Promise<string> {
  return promptForStringField({
    label,
    secret: false,
    required: false,
    defaultValue,
    customValidate: stringPortValidate,
  })
}

export async function promptForRequiredSecretField({
  label,
  defaultValue,
  customValidate,
}: {
  label: string
  defaultValue?: string
  customValidate?: StringFieldCustomValidateFn
}): Promise<string> {
  return promptForStringField({ label, secret: true, required: true, defaultValue, customValidate })
}

export async function promptForOptionalSecretField({
  label,
  defaultValue,
  customValidate,
}: {
  label: string
  defaultValue?: string
  customValidate?: StringFieldCustomValidateFn
}): Promise<string> {
  return promptForStringField({ label, secret: true, required: false, defaultValue, customValidate })
}

export async function promptForOptionalNumberField({
  label,
  defaultValue,
  min,
  max,
}: {
  label: string
  defaultValue?: number
  min?: number
  max?: number
}): Promise<number | undefined> {
  return number({
    message: label,
    default: defaultValue,
    min: min,
    max: max,
    required: false,
  })
}

export async function promptForRequiredNumberField({
  label,
  defaultValue,
  min,
  max,
}: {
  label: string
  defaultValue?: number
  min?: number
  max?: number
}): Promise<number> {
  return number({
    message: label,
    default: defaultValue,
    min: min,
    max: max,
    required: true,
  })
}

export async function promptForBooleanField({
  label,
  defaultValue,
}: {
  label: string
  defaultValue?: boolean
}): Promise<boolean> {
  return confirm({
    message: label,
    default: defaultValue,
  })
}
