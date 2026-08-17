# Hermes Desktop OpenSpec read surface

## ADDED Requirements

### Requirement: Desktop plugin registration and API boundary
The OpenSpec package SHALL expose a runtime Desktop plugin with id `openspec`, route `/openspec`, and sidebar label `OpenSpec`. All OpenSpec data requests SHALL use namespace-scoped `ctx.rest`; the plugin SHALL NOT use direct network fetches or require Hermes Desktop core changes.

#### Scenario: Plugin loads through supported runtime seam
- **GIVEN** `desktop/plugin.js` is discovered by Hermes Desktop's runtime plugin loader
- **WHEN** the plugin registers
- **THEN** it contributes one `/openspec` route and one `OpenSpec` sidebar entry
- **AND** navigating through the entry renders the OpenSpec page without a Hermes Desktop restart

#### Scenario: API requests remain namespace scoped
- **GIVEN** the OpenSpec page needs backend data
- **WHEN** it requests sources, change details, idea details, specs, or spec diffs
- **THEN** each request is made through `ctx.rest` using a path relative to `/api/plugins/openspec`
- **AND** no direct `fetch`, absolute backend URL, duplicated authentication, or filesystem access is used

### Requirement: Source selection and project summary
The page SHALL load registered sources from `GET /sources`, provide a source selector, and render the selected source's OpenSpec counts and repository identity rather than presenting the source directory list as the primary experience.

#### Scenario: Sources load successfully
- **GIVEN** two or more registered sources are returned
- **WHEN** the OpenSpec page opens
- **THEN** one source is selected automatically
- **AND** the user can switch sources without leaving `/openspec`
- **AND** the selected view shows source name plus change, idea, and spec counts

#### Scenario: No sources are registered
- **GIVEN** `GET /sources` returns an empty array
- **WHEN** the page finishes loading
- **THEN** it renders an empty state explaining that no OpenSpec sources are registered
- **AND** it does not render an empty board as successful project content

#### Scenario: Selected source is invalid
- **GIVEN** a selected source has `valid: false`
- **WHEN** the page renders it
- **THEN** it shows the backend-provided error and repository path
- **AND** it does not attempt change, idea, or spec detail requests for that source

### Requirement: Changes and ideas board
For the selected valid source, the page SHALL render ideas and changes from the `openspec` object returned by `GET /sources` as an actionable read-only board.

#### Scenario: Board renders project work
- **GIVEN** the selected source contains ideas and changes
- **WHEN** the board view renders
- **THEN** cards are grouped into Ideas, Draft, Todo, In Progress, Done, and Archived states
- **AND** each card shows title, copyable token, artifact availability, and task progress when present
- **AND** the selected source directory path is secondary metadata, not the main content

#### Scenario: Board is filtered
- **GIVEN** the board contains multiple cards
- **WHEN** the user enters text in the board filter
- **THEN** only cards whose title, name, or token contains that text remain visible
- **AND** clearing the filter restores all cards

#### Scenario: Archived visibility is toggled
- **GIVEN** archived changes exist
- **WHEN** the user disables archived visibility
- **THEN** archived cards are hidden without changing backend data

### Requirement: Change and idea detail views
The page SHALL provide read-only details for board items using existing detail endpoints.

#### Scenario: Change detail opens
- **GIVEN** a change card is selected
- **WHEN** `GET /sources/{source_id}/changes/{change_name}` succeeds
- **THEN** the page exposes every returned proposal, tasks, design, and specs artifact as a labeled tab
- **AND** absent artifacts do not produce empty tabs
- **AND** task content shows completed count, total count, and individual checkbox state

#### Scenario: Change spec diff is inspected
- **GIVEN** change detail contains a modified spec with semantic or unified diff data
- **WHEN** the user selects its diff view
- **THEN** added, modified, and removed requirements are distinguishable
- **AND** raw unified diff remains available when returned by the backend

#### Scenario: Idea detail opens
- **GIVEN** an idea card is selected
- **WHEN** `GET /sources/{source_id}/ideas/{idea_name}` succeeds
- **THEN** its markdown content is rendered in a readable detail view
- **AND** no edit controls are shown

### Requirement: Current specs and repository diff browser
The page SHALL provide a Specs view backed by existing `/spec-browser` and `/specs` endpoints, including current specs and repository differences.

#### Scenario: Current specs are browsed
- **GIVEN** the selected source contains current specs
- **WHEN** the user opens Specs
- **THEN** `GET /sources/{source_id}/spec-browser` lists spec titles and paths
- **AND** selecting a spec renders its current content

#### Scenario: Worktree differences are browsed
- **GIVEN** the selected source has OpenSpec spec changes between HEAD and worktree
- **WHEN** the user selects worktree diff mode
- **THEN** the page requests `/sources/{source_id}/spec-browser?dirty=true`
- **AND** shows changed file count and file statuses
- **AND** offers semantic, side-by-side, or raw diff representations when corresponding backend data exists

#### Scenario: No spec differences exist
- **GIVEN** dirty spec-browser mode returns zero files
- **WHEN** the response completes
- **THEN** the page shows a distinct `No spec changes between HEAD and worktree` empty state

### Requirement: Loading, retry, and failure states
Every asynchronous read surface SHALL distinguish loading, empty, and error outcomes and provide recovery without reloading Hermes Desktop.

#### Scenario: Initial request is pending
- **GIVEN** a source or detail request has not completed
- **WHEN** its view renders
- **THEN** a loading indicator is visible
- **AND** stale success content is not presented as current response data

#### Scenario: Backend request fails
- **GIVEN** `ctx.rest` rejects because the backend is unavailable, unauthorized, or returns an error
- **WHEN** the failure is handled
- **THEN** the affected view shows a concise error state
- **AND** a retry action repeats only the failed read request
- **AND** the plugin does not crash or remove unrelated Desktop contributions

### Requirement: Local and remote behavior
The read surface SHALL behave through the same plugin API contract when Desktop connects to either a local or remote Hermes backend.

#### Scenario: Remote Desktop session renders OpenSpec data
- **GIVEN** Desktop is authenticated to a remote Hermes backend with the OpenSpec plugin enabled
- **WHEN** the user opens `/openspec`
- **THEN** source, board, detail, and spec requests resolve through `ctx.rest`
- **AND** no client-side assumption requires backend repository paths to exist on the Windows client

### Requirement: Read-only first release
This change SHALL NOT add source registry mutations, OpenSpec initialization, task mutation, file edits, or other write controls.

#### Scenario: User inspects read surface
- **GIVEN** any source, board, detail, or spec view is open
- **WHEN** available actions are inspected
- **THEN** no add, edit, delete, initialize, task-toggle, or file-write control is present
- **AND** existing backend write endpoints remain unchanged

## Out of Scope

- Source add, edit, remove, or initialization controls
- Task completion or artifact editing
- New backend routes or response semantics
- Hermes Desktop core modifications
- Pixel-perfect parity with existing web dashboard
- Sandboxing arbitrary third-party runtime plugins
- Upstream issue or pull request before maintainer scope agreement
