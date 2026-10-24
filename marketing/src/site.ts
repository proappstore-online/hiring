/**
 * The marketing site's content and settings. Everything the pages say about the
 * app comes from this file: edit the copy, swap in your own images (put them in
 * public/assets/), or change the pages in src/pages/ directly. Keep claims true —
 * no invented pricing, testimonials, customer counts or reviews; leave an optional
 * section empty and it is left out.
 *
 * The Privacy Policy and Terms are a starting point, not legal advice. Review them
 * against what your app actually does before you rely on them.
 */
export const site = {
  appId: 'hiring',
  name: 'hiring',
  appUrl: 'https://hiring.proappstore.online/',
  /** Who runs the app; named as the operator on the legal pages and in the footer. */
  owner: 'The hiring team',
  /** Where people can reach you. Leave empty to point them at the app instead. */
  contactEmail: '',
  /** Optional help page or support link shown in the footer. */
  supportUrl: '',
  /** Jurisdiction whose law governs the Terms. Leave empty to omit the clause. */
  governingLaw: '',
  /** Shown on the legal pages; update it whenever you change them. */
  legalUpdated: '2026-10-21',
  /** Brand colours, mapped into the Tailwind theme (bg-accent, text-accent-deep, ...). */
  colors: {
    accent: '#d86f4d',
    /** Buttons and links: dark enough for white text, and for text on paper. */
    accentDeep: '#9f4427',
    accentSoft: '#ffd4bf',
    ink: '#111111',
    muted: '#666666',
    paper: '#ffffff',
    paperDeep: '#f7f7f7',
  },
  headline: 'Manage recruiting across distinct brands.',
  summary: 'Hiring brings scoped application review, interview scorecards and human decision records into one recruiting workspace. Public candidate intake remains closed while release verification is completed.',
  ctaLabel: 'Open hiring',
  /** Optional hero image, e.g. { src: '/assets/hero.png', alt: '...' }. Without one, a brand-colour panel is shown. */
  heroImage: null as Image | null,
  /** Optional product screenshots, shown in a gallery. */
  screenshots: [] as Image[],
  benefits: [
    { title: 'Work within your brand', body: 'Staff access follows organization, brand and assignment permissions.' },
    { title: 'Keep review records together', body: 'Track applications, interview assignments and structured scorecards in the recruiting workspace.' },
    { title: 'Record human decisions', body: 'Keep attributed decisions and offer approval history. Provider acceptance is recorded separately from confirmed delivery.' },
  ],
  howItWorks: [
    { title: 'Open the app', body: 'Go to hiring in any modern browser. It installs like an app on phone and desktop.' },
    { title: 'Sign in', body: 'Use your GitHub or Google account. No new password to remember.' },
    { title: 'Choose your workspace', body: 'Authorized staff select an organization and brand to review their permitted applications.' },
  ],
}

interface Image {
  src: string
  alt: string
}

/** How the legal pages tell people to reach you. */
export const contact = site.contactEmail
  ? `email ${site.contactEmail}`
  : `contact us through ${site.appUrl}`
