// Adapter for a future platform dispatch hook. The current app tool runtime is
// hosted by ProAppStore and does not call this module.
const secretKey = /token|secret|password|(?:^|_)key(?:_|$)|api_key|auth|credential/i

export function redactAuditInputs(value) {
  if (Array.isArray(value)) return value.map(redactAuditInputs)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, secretKey.test(key) ? '[REDACTED]' : redactAuditInputs(nested)]))
  }
  return value
}

export function createAuditedDispatch({ tools, dispatch, appendAudit, logReads = false, now = Date.now, id = () => crypto.randomUUID() }) {
  const operations = new Map(tools.map(tool => [tool.name, tool.operation]))
  return async function auditedDispatch(name, inputs, context = {}) {
    const operation = operations.get(name)
    if (!operation) throw new Error(`Unknown tool: ${name}`)
    const shouldLog = operation !== 'query' || logReads
    let result
    let error
    try { result = await dispatch(name, inputs, context); return result }
    catch (caught) { error = caught; throw caught }
    finally {
      if (shouldLog) {
        await appendAudit({
          id: id(), timestamp: now(), caller_agent_id: context.caller_agent_id ?? null,
          caller_session_id: context.caller_session_id ?? null, tool_name: name,
          input_json: JSON.stringify(redactAuditInputs(inputs)),
          result_status: error ? 'failed' : 'completed',
          result_summary: error ? error.name : context.summarize?.(result) ?? null,
          affected_entity_ids_json: JSON.stringify(context.affected_entity_ids ?? []),
          operation_id: inputs?.operation_id ?? null,
        })
      }
    }
  }
}
