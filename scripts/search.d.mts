export class SearchError extends Error { status: number }
export function searchRecords(actions: (name: string, params: Record<string, unknown>) => Promise<unknown>, name: string, params: Record<string, unknown>): Promise<{rows: Record<string, any>[]; next_cursor: string | null}>
