# Phase Gate Review: Hermes Desktop read surface

Reviewed: 2026-08-17
Change: `hermes-desktop-read-surface`

## SPEC Gate

**Verdict: PASS**

- Completeness: 8 requirements, each with at least one scenario; 18 scenarios total.
- Testability: scenarios use observable GIVEN/WHEN/THEN outcomes.
- Scope: read-only Desktop experience over existing OpenSpec backend.
- Constraints: runtime ESM, allowed imports, namespace-scoped REST, remote backend, no client filesystem dependency, and safe markdown are explicit.
- Out of scope: writes, new backend semantics, Hermes core changes, pixel parity, and upstream contribution before approval are explicit.
- Structural validation: `openspec validate hermes-desktop-read-surface --strict` returned valid on 2026-08-17.

Blocking issues: none.

Warnings: none.

## DESIGN Gate

**Verdict: PASS**

- Traceability: every product requirement maps to design section, task cluster, exact production/test path, and executable or visual check.
- No orphan work: governance, documentation, deployment, rollback, and contribution tasks map to proposal delivery gates.
- Granularity: 41 uniquely numbered tasks; implementation is split into contract, helper, component, test, and verification slices rather than multi-file epics.
- Paths: production work targets `desktop/plugin.js`; executable harness targets `tests/desktop-plugin-smoke.mjs`; documentation and spike evidence paths are explicit.
- Verification: every task contains an explicit `verify` clause.
- Dependencies: tests precede implementation within each capability; automated verification precedes parent review; review precedes deployment; deployment remains approval-gated.

Blocking issues: none.

Warnings:

- Safe markdown is intentionally a bounded subset, not CommonMark.
- Runtime CSS availability requires live visual proof; design uses SDK controls and inline layout styles to reduce risk.
- Reference-to-reference spec comparison is deferred; current and worktree modes satisfy initial read surface.

## Traceability

### R1 Desktop plugin registration and API boundary

- Design: sections 1 and 2
- Tasks: 2.1 through 2.4, 7.1, 7.2
- Production: `desktop/plugin.js`
- Test: `tests/desktop-plugin-smoke.mjs`, ESM parse, contribution metadata, exact REST paths, forbidden fetch/mutation checks

### R2 Source selection and project summary

- Design: sections 3 and 7
- Tasks: 3.1 through 3.4, 8.3
- Production: `desktop/plugin.js`
- Test: selection/query-state helper cases plus live source-selector/count observation

### R3 Changes and ideas board

- Design: section 4
- Tasks: 4.1 through 4.5, 8.3
- Production: `desktop/plugin.js`
- Test: grouping, sorting, filtering, archived visibility, card metadata, and live board interaction

### R4 Change and idea details

- Design: section 5
- Tasks: 5.1 through 5.6, 8.3
- Production: `desktop/plugin.js`
- Test: encoded detail paths, conditional tabs, task counts, markdown safety, spec representations, and live detail dialog

### R5 Current specs and repository diff browser

- Design: section 6
- Tasks: 6.1 through 6.5, 8.4
- Production: `desktop/plugin.js`
- Test: current/dirty paths, selected path encoding, state/diff helper cases, and live Specs proof

### R6 Loading, retry, and failure states

- Design: section 7
- Tasks: 3.4, 5.4, 5.5, 6.3, 6.4, 8.5
- Production: `desktop/plugin.js`
- Test: loading/error/empty/content classifier cases and recoverable live failure test

### R7 Local and remote behavior

- Design: API adapter, rollout, and risk sections
- Tasks: 2.3, 8.2 through 8.4
- Production: `desktop/plugin.js`
- Test: no absolute URL/filesystem access, remote SHA match, and remote-backed Desktop screenshots

### R8 Read-only first release

- Design: non-goals and API adapter sections
- Tasks: 2.1 through 2.3, 4.3, 5.4, 5.5, 7.6
- Production: `desktop/plugin.js`
- Test: no mutation adapter, no mutation verbs, no write controls, and changed-scope review

## Implementation Release Condition

Artifacts are spec-ready. Implementation remains unauthorized until explicit user approval. Live deployment requires separate approval at task 8.2.

## FINAL Gate

Reviewed: 2026-08-17

**Verdict: CONDITIONAL**

The reviewed implementation is deployed and the fork branch is release-ready for the verified Work-board scope. The OpenSpec change remains active until live change-detail and Specs evidence is captured; upstream issue/PR work remains separately approval-gated.

### Verified evidence

- Commit: `c3f92d2f5f3c1b21d783598b264971be93014233` before this evidence-only documentation update.
- Deployed plugin: local and Tennant SHA-256 `234302309c1b3b6189e88fdc0fceaea663b569eb051640ad10674f26cdb20430`, 57,380 bytes.
- Rollback: baseline commit `059282c`, plugin SHA-256 `29f7393e1102a354083da2ab35f81890814a0310961d31fe7c700d7891cceb85`; pre-deploy live backup `plugin.js.rollback-6096040b2c484677-20260817-161239.bak` preserved.
- Live Work view: OpenSpec route active on Tennant against remote VPS backend; `ivault` source selector/counts and non-empty board visible; empty lanes collapsed; no plugin error banner; user confirmed board-owned horizontal scrollbar works.
- Live screenshot SHA-256: `42769fd58921a2d2c2657c1c4f75b79a316e4c8eb14c992b1e8418a5d39fa64a` (not committed because it contains the user's full desktop).
- `node --input-type=module --check < desktop/plugin.js`: exit 0.
- `node tests/desktop-plugin-smoke.mjs`: 244 passed, 0 failed.
- `node tests/lane-override-behavior.mjs`: 23 passed, 0 failed.
- `node spikes/001-desktop-route-api/smoke.mjs`: 36 passed, 0 failed.
- Host-integrated `pytest -q`: 55 passed in 3.03s.
- `openspec validate hermes-desktop-read-surface --strict`: valid.
- `git diff --check 527d3b2..HEAD`: clean before this documentation update.

### Open conditions

- Task 8.3 remains open because filter, archived-toggle, and change-detail interaction were not all captured live.
- Task 8.4 remains open because Current Specs plus dirty/no-diff state were not captured live.
- Task 9.2 remains open because no maintainer-scope approval exists for an upstream issue or draft PR.
- Live screenshot shows a `#[object Object]` card badge. This is a readability defect outside the verified lane-scroll repair and should be corrected before claiming full visual acceptance.
