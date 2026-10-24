type Actions = (name: string, params: Record<string, unknown>) => Promise<any>
export function auditedGatewayRead(actions: Actions, name: string, params: Record<string, unknown>, requestId?: string): Promise<any>
export function retrieveCandidateExport(actions: Actions, params: Record<string, unknown>): Promise<Record<string, unknown>>
export function requestAsyncCandidateExport(actions: Actions, params: Record<string, unknown>): Promise<{state: string; expires_at: number}>
export function downloadAsyncCandidateExport(actions: Actions, params: Record<string, unknown>, accessId?: string): Promise<Record<string, unknown>>
