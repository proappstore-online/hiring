/** Trusted asynchronous queue consumer. Bind actions to the platform worker RPC;
 * never accept a browser-provided actor or run the queue in a browser session.
 * SQL owns projection, authorization, expiry and atomic readiness/audit.
 */
export async function assembleCandidateExports({ actions }) {
  const rows = result => result?.rows ?? result?.results?.[0]?.rows ?? []
  const jobs = rows(await actions('list_candidate_export_queue', {}))
  let attempted = 0
  for (const job of jobs) {
    await actions('assemble_candidate_export', job)
    attempted++
  }
  return { attempted }
}
