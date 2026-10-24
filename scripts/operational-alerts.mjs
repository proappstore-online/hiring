/** Content-free alert evaluation for authenticated health snapshots.
 * The trusted scheduler owns scope, poll frequency, deduplication and transport.
 * No arbitrary fields, IDs, errors or callback bodies reach the alert sink.
 */
export function operationalAlerts(health, { callbackFailures = 0 } = {}) {
  if (!health || !Number.isSafeInteger(health.observed_at)) throw new TypeError('Authenticated health snapshot required')
  const rules = [
    ['queue_age', 'oldest_pending_draft_age_ms', 900000],
    ['stale_attempt', 'oldest_sending_age_ms', 900000],
    ['delivery_failure', 'failed_count', 1],
    ['delivery_unknown', 'unknown_count', 1],
    ['quota', 'quota_count', 1],
    ['outage', 'outage_count', 1],
    ['retention_failure', 'retention_failed_count', 1],
    ['retention_blocked', 'retention_blocked_count', 1],
    ['retention_unknown', 'retention_unknown_count', 1],
    ['access_denial', 'denied_or_missing_24h', 10],
    ['callback_failure', 'callbackFailures', 1],
  ]
  return rules.flatMap(([code, key, threshold]) => {
    const value = key === 'callbackFailures' ? callbackFailures : health[key]
    return Number.isSafeInteger(value) && value >= threshold
      ? [{ code, value, observed_at: health.observed_at, runbook: 'docs/operational-monitoring.md' }] : []
  })
}

/** Poll once; await delivery so a failed alert transport is observable to the host.
 * No background scheduler, automatic deletion or job replay is started here.
 */
export async function monitorOperations({ actions, scope, callbackFailures = 0, notify }) {
  const { rows } = await actions('get_operational_health', scope)
  if (rows?.length !== 1) throw new Error('Operational health unavailable')
  const alerts = operationalAlerts(rows[0], { callbackFailures })
  for (const alert of alerts) await notify(alert)
  return alerts
}
