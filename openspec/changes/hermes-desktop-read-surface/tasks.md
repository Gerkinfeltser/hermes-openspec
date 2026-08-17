## 1. Spike Evidence and Baseline

- [x] 1.1 Append parent-observed live evidence to `spikes/001-desktop-route-api/README.md`, including 2026-08-17 screenshot facts and wording that `VALIDATED` applies to route/sidebar/API seam only; verify caveats no longer say live Desktop and real backend are unobserved.
- [x] 1.2 Preserve commit `059282c` as rollback baseline and record its `desktop/plugin.js` SHA-256 in `spikes/001-desktop-route-api/README.md`; verify `git show 059282c:desktop/plugin.js` succeeds and recorded hash matches command output.
- [x] 1.3 Run `node --check` against baseline `desktop/plugin.js` and `node spikes/001-desktop-route-api/smoke.mjs`; verify both commands exit 0 and record exact results in spike report.

## 2. Runtime Contract and API Adapter

- [x] 2.1 Create failing contract cases in `tests/desktop-plugin-smoke.mjs` for plugin id, `/openspec` route, sidebar metadata, allowed imports, no JSX, and no direct `fetch`; verify test command exits nonzero before implementation.
- [x] 2.2 Add failing path-builder cases in `tests/desktop-plugin-smoke.mjs` for sources, encoded change/idea names, current specs, dirty specs, and encoded spec path; verify malformed/unencoded output is rejected.
- [x] 2.3 Refactor `desktop/plugin.js` to keep registration shell and add read-only API adapter over `ctx.rest`; verify tests from 2.1 and 2.2 pass and source contains no mutation method or absolute API URL.
- [x] 2.4 Export frozen pure-helper `__test` seam from `desktop/plugin.js`; verify runtime default export remains valid and named helper export imports through loader-style specifier rewriting.

## 3. Source Selection and Request States

- [x] 3.1 Add failing helper cases in `tests/desktop-plugin-smoke.mjs` for first-valid source selection, all-invalid fallback, no-source state, and source-specific query keys; verify failure before production changes.
- [x] 3.2 Implement source-selection and query-state helpers in `desktop/plugin.js`; verify cases from 3.1 pass.
- [x] 3.3 Implement Desktop-native page header, source `Select`, refresh action, selected-project counts, and muted path metadata in `desktop/plugin.js`; verify source rows are no longer primary page content through source inspection plus live check task 8.3.
- [x] 3.4 Implement loading, no-sources, invalid-source, and source-request error/retry views in `desktop/plugin.js`; verify helper tests cover all four outcomes and retry calls only sources query refetch.

## 4. Changes and Ideas Board

- [x] 4.1 Add failing pure-helper cases in `tests/desktop-plugin-smoke.mjs` for status normalization, sequence/title sorting, text filtering, archived visibility, and artifact/task metadata; verify failure before implementation.
- [x] 4.2 Implement board grouping/filter/sort helpers in `desktop/plugin.js`; verify all 4.1 cases pass with ideas plus every required change status.
- [x] 4.3 Implement Work view and columns in `desktop/plugin.js` using SDK controls and overflow-safe layout; verify source inspection finds Ideas, Draft, Todo, In Progress, Done, and Archived labels plus no write control.
- [x] 4.4 Implement board cards with title, token copy action, artifact badges, sequence, and task fraction in `desktop/plugin.js`; verify test fixture card exposes each populated field and missing optional fields do not crash render helper.
- [x] 4.5 Implement filter input and archived toggle in `desktop/plugin.js`; verify helper test clears/restores filter and hides/restores archived column without API calls.

## 5. Change and Idea Details

- [x] 5.1 Add failing adapter/tab/task cases in `tests/desktop-plugin-smoke.mjs` for encoded detail paths, omission of absent tabs, task sections, and done/total counts; verify failure before production changes.
- [x] 5.2 Implement safe markdown block parser in `desktop/plugin.js` for headings, paragraphs, lists, task markers, fenced code, inline code, and links; verify tests keep raw HTML as text and never emit `dangerouslySetInnerHTML`.
- [x] 5.3 Implement task parser and progress model in `desktop/plugin.js`; verify mixed checked/unchecked fixture produces exact section, done, and total values.
- [x] 5.4 Implement read-only change detail `Dialog` with conditional Proposal, Tasks, Design, and Specs tabs in `desktop/plugin.js`; verify absent backend fields omit corresponding tabs.
- [x] 5.5 Implement read-only idea detail in same dialog shell in `desktop/plugin.js`; verify it requests idea endpoint, renders content, and exposes no edit action.
- [x] 5.6 Implement change-spec Proposed and Diff views in `desktop/plugin.js`; verify semantic requirement groups and raw unified diff appear only when corresponding response fields exist.

## 6. Specs Browser and Diffs

- [x] 6.1 Add failing cases in `tests/desktop-plugin-smoke.mjs` for current and dirty spec-browser requests, selected spec path encoding, changed count, status, and semantic/split/raw availability; verify failure before implementation.
- [x] 6.2 Implement specs API helpers and representation-selection helpers in `desktop/plugin.js`; verify 6.1 cases pass.
- [x] 6.3 Implement Current Specs list and selected content view in `desktop/plugin.js`; verify selection requests `/specs?path=` and successful empty list shows `No specs found`.
- [x] 6.4 Implement Worktree mode in `desktop/plugin.js`; verify it requests `?dirty=true`, shows changed count/statuses, and zero files shows `No spec changes between HEAD and worktree`.
- [x] 6.5 Implement Semantic, Side-by-side, and Raw diff views in `desktop/plugin.js`; verify each mode is hidden when required data is absent and raw lines classify added, removed, hunk, and context tones.

## 7. Automated Verification and Documentation

- [x] 7.1 Run `node --check` on a temporary `.mjs` copy of `desktop/plugin.js`; verify exit 0.
- [x] 7.2 Run `node tests/desktop-plugin-smoke.mjs`; verify all cases pass, temporary files are removed, and command exits 0.
- [x] 7.3 Run existing repository tests with `pytest -q`; verify exit 0 and no pre-existing suite regression.
- [x] 7.4 Update appropriate root documentation with Desktop install path, enablement, read-only scope, remote-backend behavior, and rollback commit; verify every documented command/path exists.
- [x] 7.5 Run `openspec validate hermes-desktop-read-surface --strict`; verify valid result after all documentation changes.
- [x] 7.6 Review `git diff --check`, changed-file list, and working tree; verify no generated child harness, debug logs, secrets, backend changes, Hermes-core changes, or unrelated files remain.

## 8. Parent Review and Live Deployment Gate

- [x] 8.1 Independently review `desktop/plugin.js` and `tests/desktop-plugin-smoke.mjs` against every spec scenario; verify requirement-to-test matrix has no empty row before live copy.
- [x] 8.2 After explicit deployment approval, copy reviewed `desktop/plugin.js` to Tennant `%LOCALAPPDATA%\hermes\desktop-plugins\openspec\plugin.js`; verify local and remote SHA-256 values match without restarting Desktop.
- [ ] 8.3 On remote-backed Tennant Desktop, inspect source selector/counts, non-empty Work board, filter, archived toggle, and one change detail with artifact tabs; verify each control works and capture screenshot evidence.
- [ ] 8.4 Inspect current Specs plus dirty diff or honest no-diff empty state; verify expected content appears, capture screenshot evidence, and confirm no Windows-side repository-path access occurs.
- [x] 8.5 Force one recoverable request failure or use unavailable-backend test fixture; verify scoped error and retry behavior without plugin/Desktop crash.
- [x] 8.6 If any live acceptance check fails, restore commit `059282c` plugin bytes; verify sidebar plus source seam return, otherwise record FINAL gate evidence.

## 9. Contribution Gate

- [ ] 9.1 Commit and push implementation branch only to `Gerkinfeltser/hermes-openspec`; verify remote branch SHA matches local SHA and upstream remote is unchanged.
- [ ] 9.2 After maintainer-scope approval, open an issue or draft PR describing read-only scope, runtime constraints, screenshots, tests, and excluded writes; verify no upstream contribution is opened before that approval.
