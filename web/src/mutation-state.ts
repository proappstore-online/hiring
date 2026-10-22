export function mutationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No record changed') ? 'Conflict or access changed. Reload the latest state, check your permissions and review your changes before trying again.' : 'The action could not be confirmed. Reload and check the current state before retrying.'
}
