import {
  promptForBooleanField,
  promptForOptionalSecretField,
  promptForOptionalStringField,
} from '../../../utils/inquirer'

export async function promptForSslFields(defaultValues?: {
  sslEnabled?: boolean
  caCertificateName?: string
  caCertificateText?: string
}): Promise<{ sslEnabled: true; caCertificateName?: string; caCertificateText?: string } | null> {
  const sslEnabled = await promptForBooleanField({
    label: 'Enable SSL:',
    defaultValue: defaultValues?.sslEnabled ?? false,
  })
  if (sslEnabled === true) {
    const caCertificateName = await promptForOptionalStringField({
      label: 'CA Certificate Name:',
      defaultValue: defaultValues?.caCertificateName,
    })
    const caCertificateText = await promptForOptionalSecretField({
      label: 'CA Certificate:',
      defaultValue: defaultValues?.caCertificateText,
    })

    return {
      sslEnabled: true,
      ...(caCertificateName.length > 0 ? { caCertificateName } : {}),
      ...(caCertificateText.length > 0 ? { caCertificateText } : {}),
    }
  }

  return null
}
