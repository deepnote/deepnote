import {
  promptForBooleanField,
  promptForRequiredStringField,
  promptForRequiredStringPortField,
} from '../../../utils/inquirer'

export async function promptForSshFields(defaultValues?: {
  sshEnabled?: boolean
  sshHost?: string
  sshPort?: string
  sshUser?: string
}): Promise<{ sshEnabled: true; sshHost?: string; sshPort?: string; sshUser?: string } | null> {
  const sshEnabled = await promptForBooleanField({
    label: 'Enable SSH tunnel:',
    defaultValue: defaultValues?.sshEnabled ?? false,
  })
  if (sshEnabled === true) {
    const sshHost = await promptForRequiredStringField({ label: 'SSH Host:', defaultValue: defaultValues?.sshHost })
    const sshPort = await promptForRequiredStringPortField({
      label: 'SSH Port:',
      defaultValue: defaultValues?.sshPort ?? '22',
    })
    const sshUser = await promptForRequiredStringField({ label: 'SSH User:', defaultValue: defaultValues?.sshUser })

    return {
      sshEnabled: true,
      ...(sshHost.length > 0 ? { sshHost } : {}),
      ...(sshPort.length > 0 ? { sshPort } : {}),
      ...(sshUser.length > 0 ? { sshUser } : {}),
      sshPort,
      sshUser,
    }
  }

  return null
}
