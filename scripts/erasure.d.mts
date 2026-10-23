export type ErasureResult = {
  request_id: string; operation_id: string; application_id: string; created_at: number;
  status: 'partial'; stores_json: string; verification_code: string;
  processor: string; processor_status: 'blocked'; processor_reason: string
}
export function requestErasure(options: {
  actions: (name: string, params: Record<string, unknown>) => Promise<unknown>;
  scope: { organization_id: string; brand_id: string }; applicationId: string;
  operationId: string; identityVerified: boolean; holdsReviewed: boolean
}): Promise<ErasureResult>
