# Design: Hermes Desktop OpenSpec read surface

## Context

`desktop/plugin.js` already proves runtime discovery, route/sidebar registration, and remote `ctx.rest('/sources')` transport. Hermes Desktop runtime plugins are uncompiled single-file ESM. They may import only `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime`; JSX syntax and new npm dependencies are unavailable. Existing OpenSpec backend responses already contain board inventory, document content, task stats, semantic diffs, split inputs, and unified diffs.

Hermes Desktop SDK exports native controls including `Badge`, `Button`, `CopyButton`, `Dialog`, `EmptyState`, `ErrorState`, `Input`, `Loader`, `ScrollArea`, `SearchField`, `Select`, `SegmentedControl`, `Tabs`, `useQuery`, and `cn`. It does not export the web dashboard's Markdown component.

## Goals

- Make `/openspec` useful for project review, not source-directory reporting.
- Preserve existing backend and authentication contracts.
- Keep first release read-only.
- Work when Windows Desktop is connected to remote VPS backend.
- Produce pure helpers and executable checks that do not require Desktop for every regression.

## Non-goals

- Registry writes or OpenSpec initialization
- Artifact/task mutation
- New backend endpoints
- Hermes Desktop core or SDK additions
- Full CommonMark implementation
- Pixel parity with web dashboard

## Architecture

### 1. Single runtime module

All production logic stays in `desktop/plugin.js`. Relative imports are prohibited because runtime loader rewrites allowed bare imports and imports plugin source through a blob URL. Plugin keeps default export contract:

```js
{
  id: 'openspec',
  name: 'OpenSpec',
  register(ctx) { ... }
}
```

It registers one `ROUTES_AREA` page at `/openspec` and one `SIDEBAR_NAV_AREA` entry.

### 2. API adapter

One closure created from plugin context exposes only read methods:

- `sources()` -> `ctx.rest('/sources')`
- `change(sourceId, name)` -> `ctx.rest('/sources/{id}/changes/{name}')`
- `idea(sourceId, name)` -> `ctx.rest('/sources/{id}/ideas/{name}')`
- `specBrowser(sourceId, options)` -> `ctx.rest('/sources/{id}/spec-browser?...')`
- `spec(sourceId, path)` -> `ctx.rest('/sources/{id}/specs?path=...')`

Every path segment and query value is encoded. Adapter has no generic arbitrary-path method and no mutation method. Components receive adapter, never raw `ctx`.

### 3. Page state and navigation

`OpenSpecPage` owns selected source id and primary view (`work` or `specs`). Initial source selection uses first valid source, falling back to first returned source so invalid-source errors remain visible. Selection remains local to page for first release.

Primary layout:

1. Header: OpenSpec title, source selector, refresh button, source counts.
2. View switch: Work and Specs.
3. View body: request-specific loading/error/empty/content state.

Selected source path appears only as muted metadata in header or board summary.

### 4. Work board

Board consumes selected source's `openspec.ideas` and `openspec.changes`; no extra list endpoint is needed. Pure helpers:

- normalize status into `ideas`, `draft`, `todo`, `in-progress`, `done`, `archived`
- filter by case-insensitive title, name, or token
- sort sequence-position first, title second
- optionally omit archived column

Columns use horizontal overflow with host `ScrollArea` or native overflow. Cards show title, task fraction/progress, artifact badges, sequence position, and copyable `<source>/<token>`. Selecting card opens detail dialog.

### 5. Detail views

Change card query key includes source id and change name. Tabs exist only for non-null response fields:

- Proposal: safe markdown subset
- Tasks: parsed checkbox sections, done/total progress
- Design: safe markdown subset
- Specs: path/status plus proposed and diff switch

Idea cards call idea endpoint and render safe markdown subset in same dialog shell.

Safe markdown subset converts headings, paragraphs, unordered/ordered lists, task-list markers, fenced code, inline code, and links into React elements. Raw HTML is always displayed as text; no `dangerouslySetInnerHTML`.

### 6. Specs browser

Specs view has mode selector:

- Current: default `/spec-browser`, list returned files, fetch selected current content from `/specs?path=`.
- Worktree: `/spec-browser?dirty=true`, list changed files and status.

Worktree selected file offers representations only when data exists:

- Semantic: requirement groups and before/after fields from `semantic_diff`.
- Split: `before` and `after` content columns.
- Raw: unified `diff` lines with added/removed/context tones.

No ref picker is included in first release. Backend supports before/after refs, but adding ref validation and history controls would enlarge scope beyond required worktree diff.

### 7. Async states and retries

Each query uses stable key including mode/source/item and reports its own state. `QueryState` wrapper renders:

- `Loader` while pending
- `ErrorState` with retry button on failure
- view-specific `EmptyState` for successful empty response
- content only on success

Source switch changes query keys, preventing stale details from another project. No polling in first release; refresh is explicit.

### 8. Styling

Prefer exported SDK controls and common host utility classes already present in shipped Desktop CSS. Layout-critical values use inline style objects where runtime-only Tailwind class generation cannot be assumed. No external stylesheet is loaded.

### 9. Test seam

`desktop/plugin.js` may export a named frozen `__test` object containing pure helpers only: API path builders, status normalization, filtering/sorting, task parser, markdown block parser, diff line classifier, and state classifier. Runtime ignores named export; harness imports it through same bare-specifier rewrite used by loader simulation.

`tests/desktop-plugin-smoke.mjs` verifies:

- true ESM parse and allowed imports
- plugin identity and contribution metadata
- exact encoded REST paths, no direct fetch, no mutation verbs
- source selection and invalid-source behavior
- status grouping, filter, archived toggle helpers
- tabs omitted for missing artifacts
- task parsing and counts
- current/dirty spec-browser paths
- semantic/split/raw availability
- loading/error/empty/content classification
- markdown raw HTML remains text

Live parent verification remains mandatory for actual hooks, SDK components, CSS, remote auth, and visual behavior.

## API Traceability

| UI capability | Existing endpoint | Response used |
|---|---|---|
| Source selector and counts | `GET /sources` | `sources[]`, `valid`, `error`, `openspec.counts` |
| Work board | `GET /sources` | `openspec.ideas`, `openspec.changes` |
| Change detail | `GET /sources/{id}/changes/{name}` | `proposal`, `tasks`, `design`, `specs`, `taskStats` |
| Idea detail | `GET /sources/{id}/ideas/{name}` | `content` |
| Current specs list | `GET /sources/{id}/spec-browser` | `files`, `changedCount`, `branch` |
| Current spec content | `GET /sources/{id}/specs?path=` | `content`, `title`, `path` |
| Worktree diffs | `GET /sources/{id}/spec-browser?dirty=true` | `status`, `before`, `after`, `semantic_diff`, `diff` |

## Rollout

1. Implement and test on fork branch.
2. Copy reviewed `desktop/plugin.js` to Tennant standalone Desktop plugin path for live verification.
3. Observe source selector, non-empty board, one change detail, one idea detail when available, current Specs, and dirty diff or honest empty state against remote VPS backend.
4. Keep current spike commit available as rollback point.
5. Open maintainer issue or draft PR only after scope agreement.

## Rollback

Replace deployed `plugin.js` with commit `059282c` spike version. Runtime watcher reloads prior module and disposes current contributions without Desktop restart. Repository rollback is a normal branch revert; no backend or data migration exists.

## Risks and Mitigations

- Host CSS omits runtime class: use SDK controls and inline layout styles, verify shipped client visually.
- Hand-written Markdown parser drifts: support bounded safe subset, test raw HTML handling, avoid claiming CommonMark.
- Large boards/specs render slowly: filter in pure helpers and avoid polling; performance optimization follows observed need.
- Source switch shows stale detail: include source id in every query key and close detail on source change.
- Backend absent or unauthorized: scoped error state with retry, no plugin crash.
- Remote client cannot access VPS paths: never read paths client-side; display only as metadata.
