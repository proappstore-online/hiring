import { useSearchParams } from 'react-router-dom'
import { parseFilters, serializeFilters, type FilterKey } from './filter-params'
/**
 * Non-text filters are restored from and written to route query parameters.
 * Candidate names and source-detail search can contain PII, so text search stays
 * in component memory only: it is never written to URLs, logs, or shared links.
 * It resets on navigation away from this list, reload, or workspace changes.
 */
export function useFilterParams() {
  const [query, setQuery] = useSearchParams()
  const filters = parseFilters(query)
  const change = (key: FilterKey, value: string) => setQuery(serializeFilters(query, { ...filters, [key]: value }))
  const clear = () => setQuery(serializeFilters(query, parseFilters(new URLSearchParams())))
  return { filters, change, clear, query }
}
