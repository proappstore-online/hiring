export const PD_FIELDS = {
  overview: 'Overview', rolePurpose: 'Role Purpose', responsibilities: 'Responsibilities', requirements: 'Requirements',
  workingArrangement: 'Working Arrangement', compensation: 'Compensation', benefits: 'Benefits',
  applicationProcess: 'Application Process', privacyContact: 'Privacy & Contact',
} as const
export type PD = Partial<Record<keyof typeof PD_FIELDS, string | string[]>>
export type PDRecord = { payload: string; version: number; updated_at: number }
export function parsePD(payload?: string | null): PD {
  if (!payload) return {}
  try {
    const value = JSON.parse(payload)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.keys(PD_FIELDS).flatMap(key => {
      const item = value[key]
      return typeof item === 'string' || (Array.isArray(item) && item.every(v => typeof v === 'string')) ? [[key, item]] : []
    }))
  } catch { return {} }
}
export function PositionDescription({ pd }: { pd: PD }) {
  return <div className="space-y-5">{Object.entries(PD_FIELDS).map(([key, label]) => {
    const value = pd[key as keyof PD]
    if (!value || (Array.isArray(value) ? !value.some(v => v.trim()) : !value.trim())) return null
    return <section key={key}><h2 className="text-lg font-semibold">{label}</h2>{Array.isArray(value) ? <ul className="list-disc space-y-1 pl-6">{value.filter(v => v.trim()).map((item, i) => <li className="whitespace-pre-wrap break-words" key={i}>{item}</li>)}</ul> : <p className="whitespace-pre-wrap break-words">{value}</p>}</section>
  })}</div>
}
