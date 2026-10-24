# UI epic acceptance audit (#62, #64, #65, #68)

Audited against issue bodies and all comments on 2026-10-25. Issues #64, #65
and #68 had no comments. This audit distinguishes existing implementation from
the current delivery; it does not claim live infrastructure acceptance.

## #64 recruiter workspace

- Missing at audit: current application counts by stage. Added `get_current_pipeline`
  and `CurrentPipeline` on Overview alongside historical funnel analytics. SQL uses
  effective stage (accepted override, stage extension, then base stage), current
  effective grants, exact organization/brand/requisition scope and reviewer assignment.
  It aggregates all authorized matches, without the application list's row cap,
  and returns stage/count only. Auditors receive no widget or counts. Links open
  existing scoped stage filters. Loading, empty, error/retry and refresh are explicit;
  scope changes discard late responses. Counts are retrieved on load/refresh,
  not a realtime subscription. These operational counts do not change the separate
  privacy-suppressed historical analytics contract.
- Existing: URL filter state and safe return links (`ApplicationFilters`, `routes`),
  exact full/restricted application lookup and histories (`RecruiterScreens`),
  version/from-stage/reason/operation-bound mutations (`ApplicationDetail`),
  conflict guidance (`mutation-state`), role-scoped interviews/scorecards/offers.
- Existing evidence: routing-browser, pipeline-filters[-browser],
  application-transitions, interview[-browser], scorecards[-browser], hiring-decisions,
  permissions and workspace-ui tests. Added current-pipeline SQL/browser coverage.

## #65 candidate experience

- Existing published-only immutable snapshots and keyset pagination: `Vacancies`,
  `list_vacancies`, `get_vacancy_detail`; vacancy SQL/browser tests.
- Existing exact brand/requisition/publication/notice-bound form, unchecked optional
  consents, closed runtime intake gate, stable retry identities and receipt readback:
  `Jobs`, candidate-intake and candidate-account-browser tests.
- Existing owned account/status and confirmed, versioned, audited terminal-aware
  withdrawal: `CandidateAccount`, gateway and candidate-account-browser tests.
- Existing attachment quarantine is the required behavior: the acceptance criterion
  explicitly says attachments remain private/quarantined until scanner and serving
  gates are verified. `attachments` offers no reviewer download or public URL.
  Actual scanning and authorized serving infrastructure remain outside this UI work;
  no gate is represented as verified here. workspace-ui/application-receipts tests
  cover attachment boundaries.
- Existing two-brand, ownership, keyboard/mobile, retry, notice-change and closed-gate
  browser cases are in candidate-account-browser. No additional source gap identified.

## #68 vacancies and position descriptions

- Existing public and recruiter navigation, canonical vacancy routes and legacy
  job/apply compatibility: `App`, `PrimaryNav`, routing-browser tests.
- Existing cards, loaded-page search/filters, full escaped PD, copy/share, responsive
  keyboard links and loading/empty/error/not-found: `Vacancies`, `position-description`,
  vacancies-browser tests. Search is explicitly limited to loaded pages.
- Existing lifecycle visibility, authorized versioned draft save/preview and immutable
  publications: `VacancyManagement`, migration 0020, registered PD actions, vacancies
  SQL tests (including authorization, replay, rollback and publication boundaries).
- Existing non-executing import mapping: `vacancies-mapping-plan.md`; no importer or
  external data movement is required. No additional source gap identified.

## Validation boundary

Mocked browser tests validate UI behavior; SQLite tests execute registered SQL against
all migrations. They do not verify production scanning, file serving, provider delivery
or release gates. This delivery preserves default-closed gates and existing CI routing.
