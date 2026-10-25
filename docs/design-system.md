# Hiring design system and screen budgets

Use `web/src/design-system.tsx`, `ui.tsx`, and the `--hiring-*` tokens in
`index.css`. Preserve the app-owned warm neutral palette and dark theme.

## Hierarchy and components

Use Page for one h1 (24px), one route header and an optional primary action.
Section uses h2 (18px); subordinate form groups use h3. Do not repeat the
route title in a panel. The spacing scale is 4, 8, 12, 16 and 24px: 16px
between sections, 12px between controls, 8px inside rows. Prefer dividers to
nested cards. Keep names and stage visible before metadata.

Toolbar groups related controls with an accessible name. FilterPanel uses
one column on mobile, three on tablet, four on desktop; its mobile toggle
must have aria-expanded and aria-controls. Record rows use recordRow with
semantic links, wrapping metadata, and a minimum 44px target. EmptyState
provides a quiet bordered message with an actionable recovery when needed.
Help uses native details/summary, closed initially; keep errors, required
field guidance and safety-critical information visible.

Use `button` for the route's main task and `secondaryButton` for filters,
reset, copy, cancel, revoke and exceptional actions. Multiple independent
forms belong in collapsed task sections; only the active task should expose
its submit. Never style a list of navigation links as primary actions.

## Route map and review budget

All recruiter URLs require authorized organization/brand scope. Keep the
existing permission checks and safe return URLs in routes.ts.

| Route under /recruiter | Main task / primary action | Initial content budget |
| --- | --- | --- |
| overview | Review pipeline; follow a record | Workspace identity, pipeline, funnel; no duplicate Overview heading |
| applications | Add candidate (reviewer: Search records) | One count, filters, rows; result explanation collapsed |
| applications/new | Save candidate | One contextual form; no pipeline or setup |
| applications/:id | Review candidate; choose next action | One selected workspace subsection; contact/supporting records collapsed |
| vacancies | Add requisition when permitted | Quiet lifecycle help, record list; no second management heading |
| vacancies/new | Create requisition | One form |
| vacancies/:id | Save and preview PD when editable | Selected vacancy only; draft save/copy/close secondary |
| search | Search authorized records | One query and result list |
| talent-pool | Review retained candidates | Filters and records |
| communications | Prepare authorized message | Selected communication task; template administration separate |
| playbook | Edit selected policy | Selected editor |
| settings | Redirect to permitted scope | No recruiting controls |
| organizations/:org/brands/:brand/settings | Save selected brand task | Collapsed brand settings and staff administration |
| organizations/:org/settings | Save selected organization task | Collapsed identity, staff, add-brand tasks |
| settings/operations | Inspect diagnostics | Diagnostics only |
| compliance | Process selected privacy request | Scoped privacy task |

A read-only route need not invent a primary button. Candidate subsections
(activity, communications, interview, decision) select an independent task;
keep unrelated forms out of the initial overview. Never promote destructive
actions to the page CTA. Revoke continues to use ConfirmDialog.

## Accessibility and responsive review

Use semantic links/buttons and explicit form labels. All interactive controls
have visible keyboard focus; controls and summaries have at least 44px height.
Keep native disclosure keyboard behavior. ConfirmDialog must trap focus,
label itself, cancel on Escape, and restore focus to its trigger; do not replace
it with an unlabelled overlay. Route navigation focuses the route container.
Allow text wrapping and enlargement; no horizontal viewport overflow at 375px.
Honor reduced motion and use theme tokens instead of fixed foreground colors.

## Verification

`pnpm test` runs typechecking and all tests, including desktop/mobile screenshots
for applications, candidate overview, vacancies and brand settings in
`tests/visual/hiring`. The routing fixture uses synthetic data, local styling and
the same Chromium version pinned in package.json. Screenshots also enforce one
h1, collapsed help, viewport fit, filter keyboard focus and mobile disclosure.
To intentionally refresh images, run
`UPDATE_HIRING_VISUALS=1 node --test tests/routing-browser.test.mjs`, inspect all
changed PNGs, then run without the flag. Do not refresh snapshots to hide a
layout regression. Existing routing and administration browser tests cover
navigation, permissions, dialogs and mutations.
