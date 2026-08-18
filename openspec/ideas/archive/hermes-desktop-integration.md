# Hermes Desktop integration for OpenSpec

## Source
- Origin: human
- Created: 2026-08-17T17:03:08Z
- Tags: hermes-desktop, desktop-plugin, spike, dashboard, plugin-sdk

## Prompt
Add a first-class OpenSpec surface to Hermes Desktop from the standalone hermes-openspec plugin, without modifying Hermes core or duplicating OpenSpec backend semantics.

Observed baseline:
- OpenSpec already owns a FastAPI router at /api/plugins/openspec with source registry CRUD, initialization, change/idea/spec detail, and spec-browser endpoints.
- Existing dashboard frontend is a hand-written React IIFE in dashboard/dist/index.js (1,019 lines) plus dashboard/dist/style.css (359 lines), registered through the dashboard plugin SDK.
- Hermes Desktop supports runtime ESM plugins that register ROUTES_AREA and SIDEBAR_NAV_AREA contributions and access namespace-scoped plugin APIs through ctx.rest.
- Public repository sweep found no existing Hermes Desktop implementation, plan, issue, PR, branch, commit, or OpenSpec artifact.

Feasibility spike before formal implementation:
1. Create a disposable Desktop runtime plugin that registers an /openspec route and OpenSpec sidebar entry.
2. Prove ctx.rest('/sources') reaches the existing OpenSpec API from Desktop and renders real registered-source data.
3. Record component/API/CSS compatibility gaps, local-versus-remote behavior, authentication behavior, packaging constraints, and whether existing dashboard functions/styles can be adapted mechanically.
4. Remove or isolate throwaway spike code after verdict.

Spike verdict gate:
- VALIDATED only if route/sidebar registration works and real /sources data renders through ctx.rest without a new backend or Hermes-core changes.
- PARTIAL if it works only locally, requires small OpenSpec-owned API/packaging adjustments, or dashboard UI reuse has bounded incompatibilities.
- INVALIDATED if Desktop cannot reach plugin API through supported SDK seams or requires Hermes-core reengineering.

If validated, promote this idea into a staged OpenSpec change covering:
- OpenSpec-owned Desktop plugin package and lifecycle.
- Desktop-native route/sidebar navigation.
- API adapter over existing endpoints.
- Initial useful read surface for sources, changes, ideas, specs, task/proposal/design detail, and spec diffs.
- Source management writes only after read path is verified.
- Loading, empty, error, disabled-plugin, missing-backend, local, and remote behavior.
- Automated tests where supported plus manual Desktop verification.

Non-goals for spike:
- Pixel-perfect dashboard parity.
- New OpenSpec backend semantics.
- Hermes Desktop core modifications.
- Deployment or upstream PR before maintainer scope agreement.

Contribution path:
Open issue or draft PR before non-trivial implementation, per hermes-openspec CONTRIBUTING.md.

## Archive
- archived: 2026-08-18
- author: dami etoile <dami.etoile@gmail.com> (committed e5a66d8, 2026-07-02)
- promoted_to: changes/hermes-desktop-read-surface
