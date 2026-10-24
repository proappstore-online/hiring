/** Action requests carry text in the authenticated POST body only. Never log
 * arguments, responses or upstream errors: they may contain private data. */
export class SearchError extends Error {
  constructor(status) {
    super(status===429?'Search limit reached. Try again shortly.':'Search unavailable. Refresh and try again.')
    this.status=status
  }
}
export async function searchRecords(actions, name, params) {
  if (!['search_candidates','search_applications','get_search_candidate','get_search_application'].includes(name)) throw new SearchError(400)
  if (name.startsWith('search_') && (typeof params.q!=='string' || params.q.length>200 || params.q.includes('\0'))) throw new SearchError(400)
  let response
  try { response=await actions(name,params) } catch { throw new SearchError(503) }
  const status=response?.results?.[0]?.rows?.[0]
  if (status?.status===429) throw new SearchError(429)
  if (status?.status!==200) throw new SearchError(503)
  let rows
  try { rows=JSON.parse(status.rows_json) } catch { throw new SearchError(503) }
  if (!Array.isArray(rows)) throw new SearchError(503)
  return {rows,next_cursor:rows.at(-1)?.next_cursor??null}
}
