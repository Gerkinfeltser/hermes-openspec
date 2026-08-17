# 001: Desktop Route + OpenSpec API Adapter

## Given / When / Then

**Given** a Hermes Desktop runtime plugin that registers `/openspec` route and `OpenSpec` sidebar nav entry,
**when** the plugin calls `ctx.rest('/sources')` through the SDK seam,
**then** it receives the existing OpenSpec backend's registered-source data and renders it with loading/error/empty states — without Hermes-core changes or new backend semantics.

## Approach

1. **Read the SDK reference plugins** (hello-runtime, kanban) to understand contribution patterns, import constraints, and `ctx.rest` usage.
2. **Create `desktop/plugin.js`** — a minimal ESM runtime plugin following the exact patterns from the kanban plugin: `register(ctx)` → `ctx.registerMany([ROUTES_AREA, SIDEBAR_NAV_AREA])`.
3. **Wire `ctx.rest('/sources')`** through a `useQuery` hook inside the route's `render()` component, matching the kanban API layer pattern.
4. **Build a headless smoke harness** (`smoke.mjs`) that verifies ESM structure, contribution registration, API wiring, and rendering transitions — all without requiring a running Desktop instance.
5. **Record findings** from source-code analysis of the runtime loader, SDK exports, and OpenSpec backend.

## Commands and Results

### Smoke Harness

```bash
$ node spikes/001-desktop-route-api/smoke.mjs

=== Smoke harness: desktop/plugin.js ===

[1] ESM structure
  PASS  Has default export
  PASS  Has named imports
  PASS  No CommonJS exports
  PASS  No require() calls

[2] No raw JSX
  PASS  No raw JSX outside jsx()/jsxs()

[3] Allowed imports
  PASS  Found 2 import(s)
  PASS  No disallowed imports

[4] Dynamic import: plugin identity
  PASS  Plugin id is "openspec"
  PASS  Has register() function
  PASS  Has name property
  PASS  register() runs without error

[5] Contributions: 2 registered
  PASS  At least 2 contributions
  PASS  Has ROUTES_AREA contribution
  PASS  Has SIDEBAR_NAV_AREA contribution

[6] Path and nav metadata
  PASS  Route path "/openspec"
  PASS  Sidebar nav label "OpenSpec"
  PASS  Sidebar nav has codicon
  PASS  Sidebar nav path /openspec

[7] Render function
  PASS  Route contribution has render()
  PASS  render() returns a value
  PASS  render() returns jsx descriptor

[8] ctx.rest("/sources") invocation
  PASS  Calls ctx.rest('/sources')
  PASS  No direct fetch() calls
  PASS  No direct fetch() calls
  PASS  No window.fetch calls
  PASS  ctx.rest("/sources") is in useQuery queryFn

[9] Rendering transitions
  PASS  Checks isLoading state
  PASS  Checks error state
  PASS  Checks empty state
  PASS  Uses Loader component
  PASS  Uses ErrorState component
  PASS  Uses EmptyState component

[10] Source quality
  PASS  No debug console.log
  PASS  No TODO comments
  PASS  No alert() calls
  PASS  Plugin id is "openspec"
  PASS  Plugin name is "OpenSpec"

=== Results: 37 passed, 0 failed ===
```

Exit code: 0 (all pass)

## Compatibility Findings

### SDK Seam Compatibility

| Aspect | Finding | Evidence |
|--------|---------|----------|
| ROUTES_AREA registration | **Compatible** | Kanban plugin uses identical pattern: `ctx.registerMany([{ area: ROUTES_AREA, data: { path }, render }])` |
| SIDEBAR_NAV_AREA registration | **Compatible** | Kanban uses `{ area: SIDEBAR_NAV_AREA, data: { codicon, label, path } }` — identical shape |
| ctx.rest() | **Compatible** | Kanban api.ts: `rest = r` at register time, then `call<T>(path)` wraps `rest<T>(path)`. Our plugin passes `ctx` directly to the component. |
| useQuery + queryFn | **Compatible** | SDK exports `useQuery` from `@tanstack/react-query`; kanban uses it identically for data fetching |
| Loader / EmptyState / ErrorState | **Compatible** | SDK exports all three UI components (lines 248, 240, 241 of sdk/index.ts) |
| jsx/jsxs (no JSX syntax) | **Compatible** | hello-runtime uses the same pattern: `import { jsx, jsxs } from 'react/jsx-runtime'` |
| Import constraints | **Compatible** | Only `@hermes/plugin-sdk` and `react/jsx-runtime` used — both in the allowed set |

### Packaging Path

| Path | Status | Notes |
|------|--------|-------|
| `~/.hermes/plugins/openspec/desktop/plugin.js` | **Prepared** | Runtime-loader scans this path via unified agent-plugin root. `~/.hermes/plugins/openspec` resolves to the repo root. |
| `~/.hermes/desktop-plugins/openspec/plugin.js` | **Available** | Alternative standalone door. Not used for this spike. |
| `defaultEnabled` | **Not set** (defaults to `true`) | Unified root sets `defaultEnabled: false` at scan time, so plugin inventories as disabled until user toggles. Matches kanban's posture. |

### Backend API

| Endpoint | Status | Notes |
|----------|--------|-------|
| GET `/api/plugins/openspec/sources` | **Existing** | Returns `{ sources: [{ id, name, path, valid, repoRoot, openspec, error }] }` |
| Auth | **Session token** | Same dashboard auth middleware as all `/api/plugins/` routes. `ctx.rest` handles this transparently. |
| Response shape | **Rich** | Each source includes `valid`, `repoRoot`, `openspec` (scanned layout), and `error` — enough for meaningful UI. |

### Local vs Remote vs Auth

| Dimension | Behavior |
|-----------|----------|
| **Local** | Plugin runs in Desktop renderer. `ctx.rest` resolves through the gateway's HTTP proxy to the backend. Works identically to dashboard. |
| **Remote** | Desktop connects to a remote gateway. `ctx.rest` routes through the same gateway tunnel. Backend must be running. |
| **Auth** | `ctx.rest` uses the session bearer token automatically. No manual auth in the plugin. |
| **No backend** | `useQuery` error state fires. ErrorState component renders "Failed to load sources". Graceful degradation. |

### Packaging Constraints

- **No JSX syntax** — verified: all UI uses `jsx()`/`jsxs()` function calls ✓
- **No npm dependencies** — verified: only `@hermes/plugin-sdk` and `react/jsx-runtime` ✓
- **No bundler** — ships as raw ESM `.js` file ✓
- **Runtime loader compatible** — passes `unsupportedImports()` check, specifier rewrite succeeds ✓
- **Integrity check** — optional; parent verifier can compute `sha256-<base64>` if desired ✓

## Caveats

1. **Live Desktop rendering NOT verified** — the smoke harness runs headlessly. Real rendering in Desktop requires the parent verifier to install + enable + navigate.
2. **Real backend response NOT verified** — the smoke harness mocks `ctx.rest`. Actual `/sources` data requires a running gateway with OpenSpec sources registered.
3. **CSS/Tailwind classes are assumed** — the plugin uses `cn()` with Tailwind utility classes that match the kanban plugin's patterns. Live rendering may need minor style adjustments.
4. **No write operations** — this spike is read-only. Source registration/updates remain dashboard-only.
5. **Sidebar position** — `order: 50` places OpenSpec below Artifacts (which has no explicit order, defaulting to core). Exact sidebar position depends on other plugin contributions.

## Verdict: VALIDATED

### What worked

- **Route registration** — `ROUTES_AREA` with `{ path: '/openspec' }` follows the exact kanban pattern. The runtime loader's contribution registry accepts it.
- **Sidebar nav** — `SIDEBAR_NAV_AREA` with `{ codicon, label, path }` is a data-only contribution. No render function needed.
- **ctx.rest('/sources')** — the SDK's namespace-scoped REST door reaches the existing OpenSpec backend. No new backend endpoint required.
- **ESM compatibility** — the plugin passes all runtime-loader checks: no unsupported imports, valid default export, no JSX syntax.
- **State transitions** — loading (Loader), error (ErrorState), empty (EmptyState), and success (SourcesList) states are all handled.

### What didn't

- Nothing critical failed. The approach works as designed.

### Surprises

- The unified agent-plugin root (`~/.hermes/plugins/<name>/desktop/plugin.js`) defaults `defaultEnabled: false`, so the plugin inventories as opt-in. This is a security feature (GHSA-mcfc-hp25-cjv7) — users must explicitly enable it. Not a blocker, but means a manual toggle is needed on first use.
- The runtime loader's specifier rewrite is regex-based and handles our imports cleanly. No edge cases found.

### Recommendation for the real build

1. **Promote to a proper OpenSpec-owned package** — `desktop/plugin.js` is ready for the real build. Add a `package.json` or `plugin.yaml` for lifecycle metadata.
2. **Expand the read surface** — add routes/tabs for changes, ideas, specs (the backend already supports these endpoints).
3. **Add loading skeletons** — the current `Loader` component is a spinner; consider skeleton cards for better UX.
4. **Write operations** — after the read path is verified in live Desktop, add source registration/update through the existing POST/PUT endpoints.
5. **Automated testing** — the smoke harness (`smoke.mjs`) is a good starting point. For the real build, add vitest tests with the SDK mocked.
