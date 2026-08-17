# Add useful OpenSpec read surface to Hermes Desktop

## Why

Live spike evidence proves Hermes Desktop can load the OpenSpec runtime plugin, register `/openspec`, and render real `GET /sources` data through namespace-scoped `ctx.rest`. Current spike stops at registered directory rows, so it proves transport but does not expose OpenSpec work. Desktop needs a read-first project surface before any source-management or artifact mutation is considered.

## What Changes

- Replace source-directory report with selected-project experience.
- Add source selector with project counts and invalid-source handling.
- Add read-only Changes and Ideas board with status grouping, filter, artifact indicators, tokens, and task progress.
- Add change detail tabs for proposal, tasks, design, proposed specs, and spec diffs.
- Add idea markdown detail.
- Add current Specs browser plus worktree semantic, side-by-side, and raw diff modes.
- Add request-specific loading, empty, error, and retry states.
- Keep all data access behind existing `ctx.rest` endpoints and support local or remote Desktop sessions.

## Source Idea and Spike Evidence

- Source idea: `openspec/ideas/hermes-desktop-integration.md`
- Spike implementation: `desktop/plugin.js`
- Spike report: `spikes/001-desktop-route-api/README.md`
- Live observation, 2026-08-17: Hermes Desktop visibly rendered OpenSpec sidebar navigation, `/openspec` page, and registered sources `ivault`, `hermana-config`, and `hermes-talk` with VPS paths returned by remote backend.
- Verdict: `VALIDATED` for Desktop route/sidebar and `ctx.rest('/sources')` seams only. Product read surface remains unimplemented.

## Capabilities

### New Capabilities

- `hermes-desktop-read-surface`: Desktop-native read experience for OpenSpec sources, changes, ideas, specs, artifact details, and spec diffs.

### Modified Capabilities

- None. Existing backend API and web dashboard behavior remain unchanged.

## Impact

### Repository-owned files

- `desktop/plugin.js`: replace spike source list with complete read surface while preserving runtime ESM constraints.
- `spikes/001-desktop-route-api/README.md`: append parent-observed live result and narrow spike verdict to seam validation.
- `tests/desktop-plugin-smoke.mjs`: executable headless tests for plugin registration, API paths, source selection, board filtering, details, specs, and state transitions.
- `README.md` or plugin documentation: document Desktop installation, enablement, read-only scope, and supported local/remote behavior if existing documentation has an appropriate section.

### Existing API dependencies

- `GET /sources`
- `GET /sources/{source_id}/changes/{change_name}`
- `GET /sources/{source_id}/ideas/{idea_name}`
- `GET /sources/{source_id}/spec-browser`
- `GET /sources/{source_id}/spec-browser?dirty=true`
- `GET /sources/{source_id}/specs?path={path}`

No backend route or response change is planned.

### Runtime constraints

- Runtime plugin remains one uncompiled ESM file.
- Imports remain limited to `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime`.
- No JSX syntax or new npm dependency.
- Dynamic styling must use host-available components, inline styles, or host CSS classes already present in shipped Desktop assets.

## Out of Scope

- Source add, edit, remove, or initialization
- Task or document mutation
- New backend semantics
- Hermes Desktop core changes
- Pixel-perfect web dashboard parity
- Upstream issue or pull request before maintainer scope agreement

## Delivery Gates

1. SPEC gate must pass before design.
2. DESIGN gate must map every requirement to exact files and executable checks.
3. Implementation may be delegated only after strict OpenSpec validation and DESIGN gate PASS.
4. Parent verifier must rerun tests and observe real remote Desktop rendering for board, one change detail, and Specs view before FINAL gate.
5. Upstream contribution starts only after maintainer scope agreement.
