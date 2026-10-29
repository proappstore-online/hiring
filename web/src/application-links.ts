export type ApplicationLink = { url: string; label?: string }

export function parseApplicationLinks(value: string | null | undefined): ApplicationLink[] {
  try {
    const links = JSON.parse(value || '[]')
    if (!Array.isArray(links)) return []
    return links.filter((link): link is ApplicationLink => {
      if (!link || typeof link.url !== 'string') return false
      try { const url = new URL(link.url); return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) }
      catch { return false }
    })
  } catch { return [] }
}

export function validateApplicationLinks(links: ApplicationLink[]): string {
  if (links.length > 10) throw new Error('Add no more than ten links.')
  return JSON.stringify(links.map(({ url, label }) => {
    const trimmed = url.trim()
    let parsed: URL
    try { parsed = new URL(trimmed) } catch { throw new Error('Enter a valid link URL.') }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || trimmed.length > 2000 || /\s/.test(trimmed)) throw new Error('Links must be http or https URLs (up to 2000 characters).')
    const cleanLabel = label?.trim() || ''
    if (cleanLabel.length > 100) throw new Error('Link labels must be 100 characters or fewer.')
    return { url: trimmed, label: cleanLabel }
  }))
}
