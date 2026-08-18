#!/usr/bin/env node
/**
 * Headless smoke harness for desktop/plugin.js — full read-surface verification.
 *
 * Covers OpenSpec tasks 2.1–7.6:
 *   2.1 Contract: plugin id, route, sidebar, imports, no JSX, no fetch
 *   2.2 Path builders: encoded REST paths, no malformed output
 *   3.1 Source selection helpers
 *   4.1 Board helpers: status, sort, filter, archived toggle, artifact/task metadata
 *   5.1 Adapter/tab/task helpers: detail paths, conditional tabs, task parser
 *   6.1 Spec-browser helpers: current/dirty paths, availability flags
 *   7.1–7.6 Verification commands
 *
 * Run: node tests/desktop-plugin-smoke.mjs
 * Exit 0 = pass, exit 1 = failure.
 */

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginPath = resolve(__dirname, '../desktop/plugin.js')
const source = readFileSync(pluginPath, 'utf8')

let passed = 0
let failed = 0
const failures = []

function ok(name) { passed++; console.log('  PASS  ' + name) }
function fail(name, d) {
  failed++
  const msg = '  FAIL  ' + name + (d ? ': ' + d : '')
  console.error(msg)
  failures.push({ name, detail: d })
}
function check(c, n, d) { c ? ok(n) : fail(n, d) }

console.log('=== Smoke harness: desktop/plugin.js (full read surface) ===\n')

// ═══════════════════════════════════════════════════════════════════════════════
// 2.1 Contract: plugin id, route, sidebar, allowed imports, no JSX, no fetch
// ═══════════════════════════════════════════════════════════════════════════════
console.log('[2.1] Contract: plugin registration and API boundary')

// ESM structure
check(source.includes('export default'), 'Has default export')
check(source.includes('import {'), 'Has named imports')
check(!source.includes('module.exports'), 'No CommonJS exports')
check(!source.includes('require('), 'No require() calls')

// No raw JSX
{
  const bad = source.split('\n').filter(function(l) {
    const t = l.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false
    if (t.includes('jsx(') || t.includes('jsxs(')) return false
    const stripped = t.replace(/['"`](?:[^'"`\\]|\\.)*['"`]/g, '')
    return /<[A-Z]/.test(stripped)
  })
  check(bad.length === 0, 'No raw JSX outside jsx()/jsxs()', bad.length ? 'Line: ' + bad[0].trim() : undefined)
}

// Allowed imports only
{
  const specs = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(function(m) { return m[1] })
  const allowed = new Set(['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'])
  const bad = specs.filter(function(s) { return !allowed.has(s) })
  check(specs.length > 0, 'Found ' + specs.length + ' import(s)')
  check(bad.length === 0, 'No disallowed imports', bad.length ? 'Bad: ' + bad.join(', ') : undefined)
}

// No direct fetch
check(!source.includes("fetch('"), 'No direct fetch() calls')
check(!source.includes('fetch("/'), 'No direct fetch() calls')
check(!source.includes('window.fetch'), 'No window.fetch calls')

// No mutation verbs in API adapter
check(!source.includes('ctx.rest.post'), 'No ctx.rest.post')
check(!source.includes('ctx.rest.put'), 'No ctx.rest.put')
check(!source.includes('ctx.rest.delete'), 'No ctx.rest.delete')
check(!source.includes('ctx.rest.patch'), 'No ctx.rest.patch')

// No absolute API URLs
check(!source.match(/https?:\/\/[^\s'"]+/), 'No absolute HTTP URLs in source')

// No dangerouslySetInnerHTML
check(!source.includes('dangerouslySetInnerHTML'), 'No dangerouslySetInnerHTML')

// ═══════════════════════════════════════════════════════════════════════════════
// Dynamic import with shims — run helper module
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[2.2–6.1] Dynamic import and __test execution')

const helperPath = resolve(__dirname, '_dynamic_import_helper.mjs')

let r
try {
  const raw = execSync('node ' + helperPath, { encoding: 'utf8', timeout: 30000 }).trim()
  r = JSON.parse(raw)
} catch (e) {
  fail('Dynamic import and __test execution', (e.message || '').slice(0, 500))
  r = {}
}

// Contract checks
console.log('  Plugin identity')
check(r.id === 'openspec', 'Plugin id is "openspec"', r.id ? 'Got: ' + r.id : 'null')
check(r.name === 'OpenSpec', 'Plugin name is "OpenSpec"', r.name)
check(r.hasRegister, 'Has register() function')

console.log('\n  Contributions')
check(r.contribCount >= 2, 'At least 2 contributions (got ' + r.contribCount + ')')
check(r.routeContrib !== undefined, 'Has ROUTES_AREA contribution')
check(r.navContrib !== undefined, 'Has SIDEBAR_NAV_AREA contribution')

console.log('\n  Route and sidebar metadata')
var rp = r.routeContrib && r.routeContrib.data && r.routeContrib.data.path
check(rp === '/openspec', 'Route path "/openspec"', rp ? 'Got: ' + rp : 'missing')
check(r.navContrib && r.navContrib.data && r.navContrib.data.label === 'OpenSpec', 'Sidebar nav label "OpenSpec"')
check(r.navContrib && r.navContrib.data && r.navContrib.data.codicon != null, 'Sidebar nav has codicon')
check(r.navContrib && r.navContrib.data && r.navContrib.data.path === '/openspec', 'Sidebar nav path /openspec')

console.log('\n  Render function')
var hasRender = r.routeContribHasRender === true
check(hasRender, 'Route contribution has render()')
if (r.renderResult) {
  check(!r.renderResult.error, 'render() executes without error', r.renderResult.error)
  check(r.renderResult.returned === true, 'render() returns a value')
  check(r.renderResult.isJsx === true, 'render() returns jsx descriptor')
} else if (hasRender) {
  fail('render() execution', 'renderResult not captured')
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2.2 Path builder verification
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[2.2] Path builders (from __test)')

check(r.__testAvailable, '__test export is available')
if (r.__testAvailable) {
  var pb = r.pathBuilders || {}
  check(pb.sources === '/sources', 'sourcesPath() returns "/sources"', pb.sources)

  check(pb.change === '/sources/src-1/changes/my-change',
    'changePath(src-1, my-change) encodes correctly', pb.change)
  check(pb.changeSpecial === '/sources/src-1/changes/feat%2Fwith%20spaces%20%26%20special',
    'changePath encodes special characters', pb.changeSpecial)

  check(pb.idea === '/sources/src-1/ideas/my-idea',
    'ideaPath(src-1, my-idea) encodes correctly', pb.idea)
  check(pb.ideaSpecial === '/sources/src-1/ideas/feat%2Fwith%20spaces%20%26%20special',
    'ideaPath encodes special characters', pb.ideaSpecial)

  check(pb.specBrowser === '/sources/src-1/spec-browser',
    'specBrowserPath(src-1) returns clean path', pb.specBrowser)
  check(pb.specBrowserDirty === '/sources/src-1/spec-browser?dirty=true',
    'specBrowserPath dirty adds query param', pb.specBrowserDirty)

  check(pb.spec === '/sources/src-1/specs?path=specs%2Freadme.md',
    'specPath encodes path parameter', pb.spec)
  check(pb.specSpecial === '/sources/src-1/specs?path=specs%2Fwith%20spaces.md',
    'specPath encodes special chars in path', pb.specSpecial)

  // Verify no malformed paths
  check(!String(pb.sources).includes('undefined'), 'sources path has no undefined')
  check(!String(pb.change).includes('undefined'), 'change path has no undefined')
  check(!String(pb.idea).includes('undefined'), 'idea path has no undefined')
  check(!String(pb.spec).includes('undefined'), 'spec path has no undefined')
} else {
  fail('__test path builders', '__test not available')
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3.1 Source selection helpers
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[3.1] Source selection helpers')

if (r.__testAvailable) {
  var ss = r.sourceSelection || {}
  check(ss.firstValid && ss.firstValid.id === 'src-2', 'selectFirstValid picks first valid source',
    ss.firstValid && ss.firstValid.id ? 'Got: ' + ss.firstValid.id : 'null')
  check(ss.allInvalid && ss.allInvalid.id === 'src-1', 'selectFirstValid falls back to first when all invalid',
    ss.allInvalid && ss.allInvalid.id ? 'Got: ' + ss.allInvalid.id : 'null')
  check(ss.noSources === null || ss.noSources === undefined, 'selectFirstValid returns null for empty array',
    JSON.stringify(ss.noSources))
} else {
  fail('Source selection helpers', '__test not available')
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4.1 Board helpers
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[4.1] Board helpers')

if (r.__testAvailable) {
  var bd = r.board || {}

  // Status normalization
  console.log('  Status normalization')
  check(bd.normalizeInProgress === 'in-progress', 'normalizeStatus("in-progress") = "in-progress"',
    String(bd.normalizeInProgress))
  check(bd.normalizeDraft === 'draft', 'normalizeStatus("draft") = "draft"',
    String(bd.normalizeDraft))
  check(bd.normalizeArchived === 'archived', 'normalizeStatus("archived") = "archived"',
    String(bd.normalizeArchived))
  check(bd.normalizeIdeas === 'ideas', 'normalizeStatus("ideas") = "ideas"',
    String(bd.normalizeIdeas))
  check(bd.normalizeUnknown != null, 'normalizeStatus handles unknown status',
    String(bd.normalizeUnknown))

  // Group by status
  console.log('  Group by status')
  check(Array.isArray(bd.groupKeys) && bd.groupKeys.length >= 4, 'groupByStatus returns groups',
    'Got ' + (bd.groupKeys && bd.groupKeys.length) + ' groups: ' + (bd.groupKeys && bd.groupKeys.join(', ')))
  check(bd.groupCounts && bd.groupCounts['in-progress'] === 1, 'Group "in-progress" has 1 item',
    JSON.stringify(bd.groupCounts && bd.groupCounts['in-progress']))
  check(bd.groupCounts && bd.groupCounts.ideas === 1, 'Group "ideas" has 1 item',
    String(bd.groupCounts && bd.groupCounts.ideas))
  check(bd.groupCounts && bd.groupCounts.draft === 1, 'Group "draft" has 1 item',
    JSON.stringify(bd.groupCounts && bd.groupCounts.draft))
  check(bd.groupCounts && bd.groupCounts.done === 1, 'Group "done" has 1 item',
    JSON.stringify(bd.groupCounts && bd.groupCounts.done))

  // in_progress (underscore) grouping — backend emits this spelling
  console.log('  in_progress grouping')
  check(bd.inProgressGroupCount === 3, 'All in_progress/in-progress/inprogress variants group to "in-progress"',
    'Got ' + bd.inProgressGroupCount)
  check(bd.inProgressNormalized === 'in-progress', 'normalizeStatus("in_progress") = "in-progress"',
    JSON.stringify(bd.inProgressNormalized))

  // Sort
  console.log('  Sort')
  check(Array.isArray(bd.sorted) && bd.sorted.length === 3, 'sortItems returns sorted array',
    JSON.stringify(bd.sorted))
  check(bd.sorted && bd.sorted[0] === 'c', 'sortItems: sequence 1, title Alpha first', JSON.stringify(bd.sorted))

  // Filter
  console.log('  Filter')
  check(bd.filteredAlpha && bd.filteredAlpha.length === 1 && bd.filteredAlpha[0] === 'alpha-change',
    'filterItems by title substring', JSON.stringify(bd.filteredAlpha))
  check(bd.filteredBeta && bd.filteredBeta.length === 1 && bd.filteredBeta[0] === 'beta-fix',
    'filterItems by token', JSON.stringify(bd.filteredBeta))
  check(bd.filteredEmpty && bd.filteredEmpty.length === 0, 'filterItems no match returns empty',
    JSON.stringify(bd.filteredEmpty))
  check(bd.filteredClear && bd.filteredClear.length === 3, 'filterItems empty string returns all',
    JSON.stringify(bd.filteredClear))

  // Archived toggle
  console.log('  Archived toggle')
  check(bd.withArchived === false, 'toggleArchived(true) = false', JSON.stringify(bd.withArchived))
  check(bd.withoutArchived === true, 'toggleArchived(false) = true', JSON.stringify(bd.withoutArchived))
} else {
  fail('Board helpers', '__test not available')
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5.1 Adapter and detail helpers
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[5.1] Detail helpers')

if (r.__testAvailable) {
  // Task parser
  var t = r.tasks || {}
  console.log('  Task parser')
  check(t.total === 4, 'parseTasks total count = 4', JSON.stringify(t.total))
  check(t.done === 2, 'parseTasks done count = 2', JSON.stringify(t.done))
  check(t.sections != null, 'parseTasks returns sections', JSON.stringify(t.sections))

  // Markdown parser
  var md = r.markdown || {}
  console.log('  Markdown parser')
  check(md.isArray === true, 'renderMarkdown returns array', JSON.stringify(md.isArray))
  check(md.length > 0, 'renderMarkdown produces elements', JSON.stringify(md.length))

  // State classifier
  console.log('  State classifier')
  check(md.stateLoading === 'loading', 'classifyState loading', JSON.stringify(md.stateLoading))
  check(md.stateError === 'error', 'classifyState error', JSON.stringify(md.stateError))
  check(md.stateEmpty === 'empty', 'classifyState empty', JSON.stringify(md.stateEmpty))
  check(md.stateContent === 'content', 'classifyState content', JSON.stringify(md.stateContent))
} else {
  fail('Detail helpers', '__test not available')
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6.1 Spec-browser helpers
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[6.1] Spec-browser helpers')

if (r.__testAvailable) {
  var df = r.diff || {}

  console.log('  Diff line classifier')
  check(df.added === 'added', 'classifyDiffLine("+...") = "added"', JSON.stringify(df.added))
  check(df.removed === 'removed', 'classifyDiffLine("-...") = "removed"', JSON.stringify(df.removed))
  check(df.hunk === 'hunk', 'classifyDiffLine("@@...") = "hunk"', JSON.stringify(df.hunk))
  check(df.context === 'context', 'classifyDiffLine(" ...") = "context"', JSON.stringify(df.context))

  console.log('  Diff mode availability')
  check(df.hasSemantic === true, 'hasDiffMode semantic available', JSON.stringify(df.hasSemantic))
  check(df.hasSplit === true, 'hasDiffMode split available', JSON.stringify(df.hasSplit))
  check(df.hasRaw === true, 'hasDiffMode raw available', JSON.stringify(df.hasRaw))
  check(df.noSemantic === false, 'hasDiffMode semantic unavailable when absent', JSON.stringify(df.noSemantic))

  // URL safety
  console.log('  URL safety')
  var us = r.urlSafety || {}
  check(us.httpsAllowed === true, 'isSafeUrl allows https', JSON.stringify(us.httpsAllowed))
  check(us.httpAllowed === true, 'isSafeUrl allows http', JSON.stringify(us.httpAllowed))
  check(us.relativeAllowed === true, 'isSafeUrl allows relative paths', JSON.stringify(us.relativeAllowed))
  check(us.fragmentAllowed === true, 'isSafeUrl allows fragment links', JSON.stringify(us.fragmentAllowed))
  check(us.queryAllowed === true, 'isSafeUrl allows query-only links', JSON.stringify(us.queryAllowed))
  check(us.mailtoAllowed === true, 'isSafeUrl allows mailto', JSON.stringify(us.mailtoAllowed))
  check(us.javascriptBlocked === true, 'isSafeUrl blocks javascript:', JSON.stringify(us.javascriptBlocked))
  check(us.dataBlocked === true, 'isSafeUrl blocks data:', JSON.stringify(us.dataBlocked))
  check(us.fileBlocked === true, 'isSafeUrl blocks file:', JSON.stringify(us.fileBlocked))
  check(us.vbscriptBlocked === true, 'isSafeUrl blocks vbscript:', JSON.stringify(us.vbscriptBlocked))
  check(us.emptyBlocked === true, 'isSafeUrl blocks empty string', JSON.stringify(us.emptyBlocked))
  check(us.nullBlocked === true, 'isSafeUrl blocks null', JSON.stringify(us.nullBlocked))
  // Whitespace/control obfuscation
  check(us.wsJavascriptBlocked === true, 'isSafeUrl blocks whitespace-prefixed javascript:',
    JSON.stringify(us.wsJavascriptBlocked))
  check(us.tabJavascriptBlocked === true, 'isSafeUrl blocks tab-prefixed javascript:',
    JSON.stringify(us.tabJavascriptBlocked))
  check(us.newlineJavascriptBlocked === true, 'isSafeUrl blocks newline-prefixed javascript:',
    JSON.stringify(us.newlineJavascriptBlocked))
  check(us.controlJavascriptBlocked === true, 'isSafeUrl blocks control-char-prefixed javascript:',
    JSON.stringify(us.controlJavascriptBlocked))
  check(us.uppercaseJavascriptBlocked === true, 'isSafeUrl blocks JAVASCRIPT: (uppercase)',
    JSON.stringify(us.uppercaseJavascriptBlocked))
  check(us.mixedCaseDataBlocked === true, 'isSafeUrl blocks DaTa: (mixed case)',
    JSON.stringify(us.mixedCaseDataBlocked))

  // __test is frozen
  console.log('  __test frozen')
  check(r.testFrozen === true, '__test object is frozen', JSON.stringify(r.testFrozen))

  // renderInline returns JSX (not plain objects) — verified via executable render checks
  console.log('  renderInline executable checks')
  var ix = r.inlineJsx || {}
  check(ix.isArray === true, 'renderMarkdown returns array for inline test')
  check(ix.hasParagraph === true, 'renderMarkdown produces paragraph with inline text')
  // EXECUTABLE: MarkdownElement returns JSX descriptors, not parser objects
  check(ix.blocksRenderToJsx === true, 'MarkdownElement renders all blocks to JSX (not parser objects)',
    ix.anyBlockFailed ? 'Block failed to render' : undefined)
  // EXECUTABLE: renderInline returns JSX elements for inline markers
  check(ix.inline && ix.inline.isArray === true, 'renderInline returns array')
  check(ix.inline && ix.inline.allJsx === true, 'renderInline returns JSX elements (not plain objects)')
  // EXECUTABLE: mixed bold/code/link each produce JSX
  check(ix.mixed && ix.mixed.hasThree === true, 'renderInline produces 3 JSX elements for bold+code+link',
    ix.mixed ? 'Got ' + ix.mixed.count : 'no data')
} else {
  fail('Spec-browser helpers', '__test not available')
}

// ═══════════════════════════════════════════════════════════════════════════════
// Behavioral fixture tests — backend contract alignment
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Behavioral] Backend contract fixture tests')

if (r.__testAvailable) {
  // 1. Semantic groups normalization
  var sg = r.semanticGroups || {}
  console.log('  Semantic groups normalization')
  check(sg.isArray === true, 'normalizeSemanticGroups returns array', JSON.stringify(sg.isArray))
  check(sg.length === 3, 'normalizeSemanticGroups returns 3 items (added+modified+removed)', 'Got ' + sg.length)
  check(sg.addedLabel === 'Added', 'First item labeled "Added"', JSON.stringify(sg.addedLabel))
  check(sg.modifiedLabel === 'Modified', 'Second item labeled "Modified"', JSON.stringify(sg.modifiedLabel))
  check(sg.removedLabel === 'Removed', 'Third item labeled "Removed"', JSON.stringify(sg.removedLabel))
  check(sg.noObjectString === true, 'No [object Object] in descriptions/before/after',
    !sg.noObjectString ? 'Found [object Object]' : undefined)
  check(sg.addedName === 'Auth', 'Added item preserves name', JSON.stringify(sg.addedName))
  check(sg.modifiedName === 'Data Model', 'Modified item preserves name', JSON.stringify(sg.modifiedName))
  check(sg.removedName === 'Legacy', 'Removed item preserves name', JSON.stringify(sg.removedName))
  check(sg.beforeDesc === 'Old schema with 3 fields', 'Modified before extracted from object', JSON.stringify(sg.beforeDesc))
  check(sg.afterDesc === 'New schema with 5 fields', 'Modified after extracted from object', JSON.stringify(sg.afterDesc))
  check(sg.noCrash === true, 'normalizeSemanticGroups does not crash on backend shape')
  check(sg.oldCodeWouldThrow === true, 'Old code (data.requirements.map) would throw on real backend shape')

  // 2. Card artifacts from has* booleans
  var ca = r.cardArtifacts || {}
  console.log('  Card artifacts from has* booleans')
  check(ca.hasProposal === true, 'hasProposal boolean present', JSON.stringify(ca.hasProposal))
  check(ca.hasTasks === true, 'hasTasks boolean present', JSON.stringify(ca.hasTasks))
  check(ca.hasDesign === true, 'hasDesign boolean present', JSON.stringify(ca.hasDesign))
  check(ca.hasSpecs === true, 'hasSpecs boolean present', JSON.stringify(ca.hasSpecs))
  check(ca.noArtifactsField === true, 'No artifacts field on source summary')
  check(ca.noArtifactNamesField === true, 'No artifactNames field on source summary')

  // 3. effectiveDiffMode fallback
  var ed = r.effectiveDiffMode || {}
  console.log('  Effective diff mode fallback')
  check(ed.semanticAvailable === 'semantic', 'Returns semantic when available', JSON.stringify(ed.semanticAvailable))
  check(ed.fallbackToSplit === 'split', 'Falls back to split when semantic unavailable', JSON.stringify(ed.fallbackToSplit))
  check(ed.fallbackToRaw === 'raw', 'Falls back to raw when only raw available', JSON.stringify(ed.fallbackToRaw))
  check(ed.nothingAvailable === 'semantic', 'Returns desired when nothing available', JSON.stringify(ed.nothingAvailable))
  check(ed.splitToRaw === 'raw', 'Split desired falls back to raw', JSON.stringify(ed.splitToRaw))
} else {
  fail('Backend contract fixture tests', '__test not available')
}

// ═══════════════════════════════════════════════════════════════════════════════
// Canonical status tone mapping and style shape tests
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Canonical] Status tone mapping and style shape')

if (r.__testAvailable) {
  var st = r.statusTone || {}
  console.log('  STATUS_TONE mapping')
  check(st.ideas === 'var(--ui-text-tertiary)', 'ideas -> triage tone', JSON.stringify(st.ideas))
  check(st.draft === '#a78bfa', 'draft -> scheduled tone', JSON.stringify(st.draft))
  check(st.todo === 'var(--ui-text-secondary)', 'todo -> todo tone', JSON.stringify(st.todo))
  check(st.inProgress === '#34d399', 'in-progress -> running tone', JSON.stringify(st.inProgress))
  check(st.done === 'var(--ui-text-tertiary)', 'done -> done tone', JSON.stringify(st.done))
  check(st.archived === 'var(--ui-text-quaternary)', 'archived -> archived tone', JSON.stringify(st.archived))
  check(st.unknown === 'var(--ui-text-secondary)', 'statusTone falls back to secondary for unknown', JSON.stringify(st.unknown))

  console.log('  STATUS_TONE values')
  check(st.ideasIsVar === true, 'ideas tone uses var(--ui-text-tertiary)', JSON.stringify(st.ideasIsVar))
  check(st.draftIsPurple === true, 'draft tone is #a78bfa', JSON.stringify(st.draftIsPurple))
  check(st.todoIsVar === true, 'todo tone uses var(--ui-text-secondary)', JSON.stringify(st.todoIsVar))
  check(st.inProgressIsGreen === true, 'in-progress tone is #34d399', JSON.stringify(st.inProgressIsGreen))
  check(st.doneIsVar === true, 'done tone uses var(--ui-text-tertiary)', JSON.stringify(st.doneIsVar))
  check(st.archivedIsVar === true, 'archived tone uses var(--ui-text-quaternary)', JSON.stringify(st.archivedIsVar))

  // Style shape checks
  var ll = r.laneLayout || {}
  console.log('  Canonical lane style shape')
  check(ll.expandedHasBg === true, 'Expanded lane uses color-mix canonical wash', JSON.stringify(ll.expandedHasBg))
  check(ll.expandedHasRounded === true, 'Expanded lane has 8px border-radius', JSON.stringify(ll.expandedHasRounded))
  check(ll.expandedHasPadding === true, 'Expanded lane has 8px padding', JSON.stringify(ll.expandedHasPadding))
  check(ll.railWidth === '32px', 'Rail width is 32px', JSON.stringify(ll.railWidth))
  check(ll.railFlexShrink === 0, 'Rail flex-shrink is 0', JSON.stringify(ll.railFlexShrink))

  // Static source checks for canonical styling
  console.log('  Canonical source patterns')
  check(source.includes('statusTone'), 'statusTone function used in source')
  check(source.includes('STATUS_TONE'), 'STATUS_TONE map present in source')
  check(source.includes("borderLeftColor: statusTone(status)"), 'BoardCard uses statusTone for left border color')
  check(source.includes("borderLeftWidth: '2px'"), 'BoardCard has 2px left border')
  check(source.includes("background: 'var(--ui-bg-elevated)'"), 'BoardCard uses elevated surface')
  check(source.includes('border-(--ui-stroke-tertiary)'), 'BoardCard uses canonical stroke-tertiary border class')
  check(source.includes("backgroundColor: statusTone(status)"), 'Lane/rail status dot uses statusTone')
  check(!source.includes('#1a1a2e'), 'No hardcoded blue rail background')
} else {
  fail('Canonical status tone mapping', '__test not available')
}

// ═══════════════════════════════════════════════════════════════════════════════
// Focused descriptor tests — BoardColumn and BoardCard contracts (source-level)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Descriptor] BoardColumn and BoardCard contracts')

// --- Collapsed rail ---
console.log('  Collapsed rail')
check(source.includes("writingMode: 'vertical-rl'"), 'Collapsed rail label uses writingMode vertical-rl')
check(source.includes("display: 'grid'") && source.includes("height: '20px'"), 'Status dot occupies 20px grid header slot')
check(source.includes("fontVariantNumeric: 'tabular-nums'"), 'Bare count uses tabular-nums')
check(!source.includes("justifyContent: 'center'"), 'Rail has no justifyContent center (top-flowing)')

// --- Expanded lane header ---
console.log('  Expanded lane header')
check(!source.includes("'(' + count + ')'"), 'Expanded header count has no parentheses (bare)')
check(source.includes("fontVariantNumeric: 'tabular-nums'"), 'Expanded header count uses tabular-nums')

// --- BoardCard ---
console.log('  BoardCard')
check(source.includes('border-(--ui-stroke-tertiary)'), 'Card uses canonical stroke-tertiary border class')
check(source.includes("background: 'var(--ui-bg-elevated)'"), 'Card background is elevated surface')
check(source.includes("borderLeftWidth: '2px'"), 'Card has 2px tone left border')
check(source.includes("borderLeftColor: statusTone(status)"), 'Card left border uses statusTone')

// --- BoardCard sequence badge guard ---
console.log('  BoardCard sequence badge guard')
{
  // Extract the BoardCard function body to test sequence handling
  var bcStart = source.indexOf('function BoardCard')
  var bcEnd = source.indexOf('\nfunction ', bcStart + 1)
  var bcSection = source.slice(bcStart, bcEnd > 0 ? bcEnd : source.length)

  // Guard should reject non-finite values — no [object Object] substring anywhere
  check(bcSection.includes('Number.isFinite'), 'Sequence badge uses Number.isFinite guard')
  check(bcSection.includes("typeof item.sequence === 'number'"), 'Sequence badge checks typeof === number')

  // Verify the guard pattern is correct by testing the expression directly
  var seqGuard = function(seq) {
    return typeof seq === 'number' && Number.isFinite(seq) ? '#' + seq : null
  }
  check(seqGuard(42) === '#42', 'sequence=42 renders #42')
  check(seqGuard(0) === '#0', 'sequence=0 renders #0')
  check(seqGuard(-3) === '#-3', 'sequence=-3 renders #-3')
  check(seqGuard(NaN) === null, 'sequence=NaN renders null')
  check(seqGuard(Infinity) === null, 'sequence=Infinity renders null')
  check(seqGuard({}) === null, 'sequence={} renders null (no [object Object])')
  check(seqGuard([]) === null, 'sequence=[] renders null')
  check(seqGuard('5') === null, 'sequence="5" renders null (string)')
  check(seqGuard(null) === null, 'sequence=null renders null')
  check(seqGuard(undefined) === null, 'sequence=undefined renders null')
}

// ═══════════════════════════════════════════════════════════════════════════════
// Static analysis checks — SDK usage patterns
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Static] Source analysis')

// Loading/error/empty state transitions
check(source.includes('isLoading'), 'Checks isLoading state')
check(source.includes('error'), 'Checks error state')
check(source.includes('Loader'), 'Uses Loader component')
check(source.includes('ErrorState'), 'Uses ErrorState component')
check(source.includes('EmptyState'), 'Uses EmptyState component')

// Source quality
check(!source.includes('console.log'), 'No debug console.log')
check(!source.includes('// TODO'), 'No TODO comments')
check(!source.includes('alert('), 'No alert() calls')

// Retry handlers on error states
check(source.includes('query.refetch()'), 'query.refetch() retry handler present')
check(source.includes('specQuery.refetch()'), 'specQuery.refetch() retry handler present')
// CRITICAL: No ErrorState uses onRetry (SDK does not accept it)
// Retry is handled by RetryErrorState wrapper with Button child

// Stale detail guard — item bound to source at click
check(source.includes('selectedItem.sourceId === selectedSourceId'), 'Detail dialog has source-matching gate')
check(source.includes('{ item: item, sourceId: selectedSourceId, type:'), 'onSelectItem binds item to source')
check(!source.includes('detailType'), 'Old detailType state removed')

// normalizeSemanticGroups exists and handles backend shape
check(source.includes('function normalizeSemanticGroups'), 'normalizeSemanticGroups function defined')
check(source.includes('data.requirements'), 'Reads data.requirements (backend contract)')
check(source.includes('reqs.added'), 'Extracts added array from requirements')
check(source.includes('reqs.modified'), 'Extracts modified array from requirements')
check(source.includes('reqs.removed'), 'Extracts removed array from requirements')

// effectiveDiffMode fallback
check(source.includes('function effectiveDiffMode'), 'effectiveDiffMode function defined')

// CardArtifacts reads has* booleans
check(source.includes('item.hasProposal'), 'CardArtifacts reads hasProposal')
check(source.includes('item.hasTasks'), 'CardArtifacts reads hasTasks')
check(source.includes('item.hasDesign'), 'CardArtifacts reads hasDesign')
check(source.includes('item.hasSpecs'), 'CardArtifacts reads hasSpecs')
check(!source.includes('item.artifacts || item.artifactNames'), 'Old artifacts/artifactNames pattern removed')

// ═══════════════════════════════════════════════════════════════════════════════
// Structural pattern checks — SDK compliance
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Structural] SDK usage pattern checks')

// 1. DialogContent: must be imported and used inside Dialog
check(source.includes('DialogContent'), 'DialogContent is imported from SDK')
{
  // Find DialogContent usage inside Dialog children (not just import)
  const dialogContentUsage = source.match(/jsx\(DialogContent/g)
  check(dialogContentUsage && dialogContentUsage.length >= 2,
    'DialogContent used in Dialog children (loading + error + content)',
    dialogContentUsage ? 'Found ' + dialogContentUsage.length + ' usages' : 'No usages found')
}

// 2. Select compound pattern: SelectTrigger, SelectValue, SelectContent, SelectItem
check(source.includes('SelectTrigger'), 'SelectTrigger imported from SDK')
check(source.includes('SelectValue'), 'SelectValue imported from SDK')
check(source.includes('SelectContent'), 'SelectContent imported from SDK')
check(source.includes('SelectItem'), 'SelectItem imported from SDK')
// Verify Select.Item is NOT used (old pattern)
check(!source.includes('Select.Item'), 'No Select.Item (old pattern removed)')
// Verify SelectTrigger is used in render
{
  const selectTriggerUsage = source.match(/jsx\(SelectTrigger/g)
  check(selectTriggerUsage && selectTriggerUsage.length >= 1,
    'SelectTrigger used in render', selectTriggerUsage ? 'Found' : 'Not found')
}

// 3. SegmentedControl: options+value+onChange pattern (no SegmentedControl.Item)
check(source.includes('onChange: setView'), 'SegmentedControl uses onChange prop')
check(source.includes('options:'), 'SegmentedControl uses options prop')
check(!source.includes('SegmentedControl.Item'), 'No SegmentedControl.Item (old pattern removed)')
check(!source.includes('onValueChange: setView'), 'SegmentedControl does not use onValueChange')

// 4. Tabs: TabsList + TabsTrigger (no Tabs.Content, no Tabs.List, no Tabs.Trigger)
check(source.includes('TabsList'), 'TabsList imported from SDK')
check(source.includes('TabsTrigger'), 'TabsTrigger imported from SDK')
check(!source.includes('Tabs.Content'), 'No Tabs.Content (not exported by SDK)')
check(!source.includes('Tabs.List'), 'No Tabs.List (use TabsList instead)')
check(!source.includes('Tabs.Trigger'), 'No Tabs.Trigger (use TabsTrigger instead)')

// 5. WorktreeDetailView: no useQuery, reads from files row
{
  const wtdStart = source.indexOf('function WorktreeDetailView')
  // Scope to just this function (until next function definition)
  const nextFn = source.indexOf('\nfunction ', wtdStart + 1)
  const wtdSection = source.slice(wtdStart, nextFn > 0 ? nextFn : source.length)
  check(!wtdSection.includes('useQuery'), 'WorktreeDetailView does not use useQuery')
  check(wtdSection.includes('fileInfo') || wtdSection.includes('files.find'),
    'WorktreeDetailView reads from files row directly')
}

// 6. SpecsView: resets selectedFile on sourceId change
{
  const specsStart = source.indexOf('function SpecsView')
  const nextFnSpecs = source.indexOf('\nfunction ', specsStart + 1)
  const specsSection = source.slice(specsStart, nextFnSpecs > 0 ? nextFnSpecs : source.length)
  check(specsSection.includes('setSelectedFile(null)'),
    'SpecsView resets selectedFile on sourceId change')
  // Verify the effect depends on sourceId
  const effectMatch = specsSection.match(/useEffect\([\s\S]*?\[[^\]]*sourceId/)
  check(effectMatch, 'Reset effect depends on sourceId')
}

// 6b. SpecsView: source-matching gate prevents stale queries
{
  const specsStart = source.indexOf('function SpecsView')
  const nextFnSpecs = source.indexOf('\nfunction ', specsStart + 1)
  const specsSection = source.slice(specsStart, nextFnSpecs > 0 ? nextFnSpecs : source.length)
  check(specsSection.includes('selectedSourceId'),
    'SpecsView tracks selectedSourceId for stale-source prevention')
  check(specsSection.match(/enabled:.*selectedSourceId\s*===\s*sourceId/),
    'specQuery enabled gates on sourceId match')
}

// 7. renderInline returns JSX elements, not plain objects
check(source.includes("jsx('strong'") || source.includes('jsx("strong"'),
  'renderInline produces JSX <strong> for bold')
check(source.includes("jsx('code'") || source.includes('jsx("code"'),
  'renderInline produces JSX <code> for inline code')
check(source.includes("jsx('a'") || source.includes('jsx("a"'),
  'renderInline produces JSX <a> for links')
check(!source.includes("{ type: 'bold'"), 'renderInline does not return plain bold object')
check(!source.includes("{ type: 'code'"), 'renderInline does not return plain code object')
check(!source.includes("{ type: 'link'"), 'renderInline does not return plain link object')

// 8. URL safety: isSafeUrl blocks dangerous schemes
check(source.includes('isSafeUrl'), 'isSafeUrl function defined')
check(source.includes('javascript:'), 'isSafeUrl checks javascript: scheme')
check(source.includes('data:'), 'isSafeUrl checks data: scheme')
check(source.includes('file:'), 'isSafeUrl checks file: scheme')

// 9. __test is frozen
check(source.includes('Object.freeze'), '__test export uses Object.freeze')

// 10. DialogContent in Dialog loading/error paths (not just content)
{
  const dialogLoadingMatch = source.match(/Dialog.*open.*onOpenChange.*DialogContent/)
  check(dialogLoadingMatch, 'Dialog loading state wraps content in DialogContent')
}

// ═══════════════════════════════════════════════════════════════════════════════
// SDK contract: ErrorState retry wrapper and CopyButton text prop
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[SDK] ErrorState contract: no onRetry prop')

// CRITICAL: ErrorState does NOT accept onRetry — must not appear in any jsx() call
// Use non-greedy [^\n]* to avoid matching nested jsx(Button, { onClick: onRetry })
{
  var errorStateOnRetry = source.match(/jsx\(ErrorState[^\n]*onRetry/g)
  check(!errorStateOnRetry, 'No ErrorState call passes onRetry prop',
    errorStateOnRetry ? 'Found ' + errorStateOnRetry.length + ' onRetry in ErrorState' : undefined)
}

// RetryErrorState must exist as a reusable wrapper
check(source.includes('function RetryErrorState'), 'RetryErrorState function defined')
check(source.includes('RetryErrorState'), 'RetryErrorState is used in source')

// RetryErrorState renders ErrorState as root, Button as child with onClick
// Verify via __test export: RetryErrorState descriptor structure
if (r.__testAvailable && r.retryErrorState) {
  var res = r.retryErrorState
  console.log('  RetryErrorState descriptor')
  check(res.rootIsErrorState === true, 'RetryErrorState renders ErrorState (function component) as root')
  check(res.hasButtonChild === true, 'RetryErrorState has Button child')
  check(res.buttonOnClickIsFunction === true, 'Button child onClick is a function')
  check(res.buttonLabel === 'Retry', 'Button child label is "Retry"', JSON.stringify(res.buttonLabel))
  // Execute onClick and verify it invokes the callback
  check(res.onClickInvokesCallback === true, 'Button onClick invokes the supplied retry callback')
}

console.log('\n[SDK] CopyButton contract: text prop, not value')

// CRITICAL: CopyButton requires text, not value
{
  var copyButtonValue = source.match(/jsx\(CopyButton[^)]*\bvalue:/g)
  check(!copyButtonValue, 'No CopyButton call uses value prop',
    copyButtonValue ? 'Found ' + copyButtonValue.length + ' value props on CopyButton' : undefined)
}
{
  var copyButtonText = source.match(/jsx\(CopyButton[^)]*\btext:/g)
  check(copyButtonText && copyButtonText.length >= 2, 'At least 2 CopyButton calls use text prop',
    copyButtonText ? 'Found ' + copyButtonText.length : 'None found')
}

// Board-card CopyButton must have stopPropagation: true (inside clickable card)
{
  var bcStart = source.indexOf('function BoardCard')
  var bcEnd = source.indexOf('\nfunction ', bcStart + 1)
  var bcSection = source.slice(bcStart, bcEnd > 0 ? bcEnd : source.length)
  check(bcSection.includes('stopPropagation: true'), 'BoardCard CopyButton has stopPropagation: true')
  check(bcSection.includes('text: displayToken'), 'BoardCard CopyButton uses text prop (not value)')
  check(!bcSection.includes('value: displayToken'), 'BoardCard CopyButton does not use value prop')
}

// Detail CopyButton should NOT have stopPropagation (not inside clickable card)
{
  var cdStart = source.indexOf('function ChangeDetailDialog')
  var cdEnd = source.indexOf('\nfunction ', cdStart + 1)
  var cdSection = source.slice(cdStart, cdEnd > 0 ? cdEnd : source.length)
  check(cdSection.includes('text: token'), 'ChangeDetailDialog CopyButton uses text prop')
  check(!cdSection.includes('stopPropagation'), 'ChangeDetailDialog CopyButton does not set stopPropagation')
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lane layout: horizontal overflow, expanded/collapsed, auto-collapse
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Lane] Layout constants and helpers')

if (r.__testAvailable) {
  var ll = r.laneLayout || {}

  // Width constants
  console.log('  Width constants')
  check(ll.expandedIs256 === true, 'LANE_EXPANDED_WIDTH is 256', JSON.stringify(ll.expandedIs256))
  check(ll.collapsedIs32 === true, 'LANE_COLLAPSED_WIDTH is 32', JSON.stringify(ll.collapsedIs32))

  // laneWidth helper
  console.log('  laneWidth helper')
  check(ll.expandedWidth === 256, 'laneWidth returns 256 when not collapsed', JSON.stringify(ll.expandedWidth))
  check(ll.collapsedWidth === 32, 'laneWidth returns 32 when collapsed', JSON.stringify(ll.collapsedWidth))
  check(ll.noOverridesExpanded === 256, 'laneWidth returns 256 when status not in overrides', JSON.stringify(ll.noOverridesExpanded))

  // railStyle returns correct collapsed dimensions
  console.log('  railStyle (collapsed rail)')
  check(ll.railWidth === '32px', 'railStyle width is 32px', JSON.stringify(ll.railWidth))
  check(ll.railFlexShrink === 0, 'railStyle flexShrink is 0', JSON.stringify(ll.railFlexShrink))
  check(ll.railCursor === 'pointer', 'railStyle cursor is pointer', JSON.stringify(ll.railCursor))

  // expandedStyle returns correct dimensions
  console.log('  expandedStyle (expanded lane)')
  check(ll.expandedWidthPx === '256px', 'expandedStyle width is 256px', JSON.stringify(ll.expandedWidthPx))
  check(ll.expandedFlexShrink === 0, 'expandedStyle flexShrink is 0', JSON.stringify(ll.expandedFlexShrink))
  check(ll.expandedOverflow === 'hidden', 'expandedStyle overflow is hidden', JSON.stringify(ll.expandedOverflow))

  // autoCollapseEmptyLanes
  console.log('  autoCollapseEmptyLanes')
  check(ll.collapseEmptyWhenWork === true, 'Collapses empty lanes when board has work', JSON.stringify(ll.collapseEmptyWhenWork))
  check(ll.expandNonEmpty === true, 'Does not collapse non-empty lanes', JSON.stringify(ll.expandNonEmpty))
  check(ll.expandNonEmptyTodo === true, 'Does not collapse non-empty todo', JSON.stringify(ll.expandNonEmptyTodo))
  check(ll.collapseInProgress === true, 'Collapses empty in-progress when work exists', JSON.stringify(ll.collapseInProgress))
  check(ll.collapseDone === true, 'Collapses empty done when work exists', JSON.stringify(ll.collapseDone))
  check(ll.noWorkNoCollapse === true, 'No collapse when board has no work', JSON.stringify(ll.noWorkNoCollapse))
} else {
  fail('Lane layout helpers', '__test not available')
}

console.log('\n[Lane] Static source checks')

// Lane strip owns horizontal overflow
check(source.includes('overflowX'), 'Lane strip has overflowX style')
check(source.includes("'auto'"), 'overflowX uses auto value')

// Lane strip constrains width
check(source.includes('minWidth: 0'), 'Lane strip has minWidth: 0 to prevent flex blowout')
check(source.includes('minHeight: 0'), 'Lane strip has minHeight: 0')

// Expanded lane fixed width
check(source.includes('256') || source.includes('LANE_EXPANDED_WIDTH'), 'Expanded lane uses 256px width')

// Collapsed rail width
check(source.includes("'32px'") || source.includes('LANE_COLLAPSED_WIDTH'), 'Collapsed rail uses 32px width')

// Internal vertical card scrolling
check(source.includes('overflowY'), 'Cards container has overflowY for vertical scroll')

// BoardColumn accepts collapsed and onExpand props
{
  var bcStart = source.indexOf('function BoardColumn')
  var bcEnd = source.indexOf('\nfunction ', bcStart + 1)
  var bcSec = source.slice(bcStart, bcEnd > 0 ? bcEnd : source.length)
  check(bcSec.includes('collapsed'), 'BoardColumn accepts collapsed prop')
  check(bcSec.includes('onExpand'), 'BoardColumn accepts onExpand prop')
  check(bcSec.includes('railStyle'), 'BoardColumn renders rail when collapsed')
  check(bcSec.includes('expandedStyle'), 'BoardColumn renders expanded style when not collapsed')
  check(bcSec.includes('data-lane'), 'Expanded lane sets data-lane attribute')
}

// WorkView manages collapse state
{
  var wvStart = source.indexOf('function WorkView')
  var wvEnd = source.indexOf('\nfunction ', wvStart + 1)
  var wvSec = source.slice(wvStart, wvEnd > 0 ? wvEnd : source.length)
  check(wvSec.includes('manualOverrides'), 'WorkView tracks manual collapse overrides')
  check(wvSec.includes('autoCollapseEmptyLanes'), 'WorkView uses autoCollapseEmptyLanes')
  check(wvSec.includes('computeCollapsedSet'), 'WorkView uses computeCollapsedSet helper')
  check(wvSec.includes('toggleOverride'), 'WorkView uses toggleOverride helper')
  check(wvSec.includes('computeLanePhase'), 'WorkView uses computeLanePhase for phase tracking')
  check(wvSec.includes('pruneStaleOverrides'), 'WorkView uses pruneStaleOverrides for phase pruning')
  check(wvSec.includes('prevLanePhase'), 'WorkView tracks previous lane phase')
  check(wvSec.includes('overflowX'), 'WorkView lane strip has overflowX')
  check(!wvSec.includes('ScrollArea'), 'WorkView no longer uses ScrollArea')
}

// WorkView source keying
{
  var wvkPattern = /key:\s*selectedSource\.id/
  check(wvkPattern.test(source), 'WorkView render has key={selectedSource.id} for source identity')
}

// ═══════════════════════════════════════════════════════════════════════════════
// Source action icons wiring — adapter, dialog, helpers
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Source] Source mutation adapter and helpers')

// Static source checks: createApi mutation methods exist
check(source.includes('addSource'), 'createApi has addSource method')
check(source.includes('updateSource'), 'createApi has updateSource method')
check(source.includes('initSource'), 'createApi has initSource method')
check(source.includes('removeSource'), 'createApi has removeSource method')

// Mutation methods use ctx.rest with method and body
check(source.includes("method: 'POST'"), 'addSource sends POST')
check(source.includes("method: 'PUT'"), 'updateSource sends PUT')
check(source.includes("'/sources/' + encodeURIComponent(sourceId) + '/init', { method: 'POST'"), 'initSource sends POST')
check(source.includes("method: 'DELETE'"), 'removeSource sends DELETE')

// Desktop ctx.rest forwards request bodies as objects, not pre-serialized JSON strings
check(source.includes("body: { path: path, name: name || undefined }"), 'Mutation methods pass object request bodies')
check(!source.includes("body: JSON.stringify({ path: path, name: name || undefined })"), 'Mutation methods do not pre-serialize request bodies')

// URL encoding in mutation paths
check(source.includes("'/sources/' + encodeURIComponent(sourceId) + '/init'"), 'initSource uses encoded source init path')
check(source.includes("'/sources/' + encodeURIComponent(sourceId)"), 'Mutation paths encode sourceId')

// Pure helpers exist
check(source.includes('function trimPath'), 'trimPath function defined')
check(source.includes('function extractApiError'), 'extractApiError function defined')

// trimPath behavior
if (r.__testAvailable && r.trimPath) {
  console.log('  trimPath helper')
  check(r.trimPath.basicTrim === '/path/to/repo', 'trimPath trims whitespace', JSON.stringify(r.trimPath.basicTrim))
  check(r.trimPath.noTrim === '/path/to/repo', 'trimPath passes clean strings', JSON.stringify(r.trimPath.noTrim))
  check(r.trimPath.emptyString === '', 'trimPath returns empty for empty string', JSON.stringify(r.trimPath.emptyString))
  check(r.trimPath.whitespaceOnly === '', 'trimPath returns empty for whitespace-only', JSON.stringify(r.trimPath.whitespaceOnly))
  check(r.trimPath.nonString === '', 'trimPath returns empty for null', JSON.stringify(r.trimPath.nonString))
  check(r.trimPath.number === '', 'trimPath returns empty for number', JSON.stringify(r.trimPath.number))
} else {
  fail('trimPath helper', '__test not available')
}

// extractApiError behavior
if (r.__testAvailable && r.extractApiError) {
  console.log('  extractApiError helper')
  check(r.extractApiError.nullInput === 'Unknown error', 'extractApiError handles null', JSON.stringify(r.extractApiError.nullInput))
  check(r.extractApiError.stringInput === 'bad request', 'extractApiError passes strings', JSON.stringify(r.extractApiError.stringInput))
  check(r.extractApiError.messageObj === 'not found', 'extractApiError extracts .message', JSON.stringify(r.extractApiError.messageObj))
  check(r.extractApiError.detailObj === 'conflict', 'extractApiError extracts .detail', JSON.stringify(r.extractApiError.detailObj))
  check(r.extractApiError.duplicateSource === 'Source already registered. Select it from the source list, or remove it before adding again.', 'extractApiError explains duplicate source', JSON.stringify(r.extractApiError.duplicateSource))
  check(r.extractApiError.fallback === '[object Object]', 'extractApiError falls back to String()', JSON.stringify(r.extractApiError.fallback))
} else {
  fail('extractApiError helper', '__test not available')
}

// Source dialog component
check(source.includes('function SourceDialog'), 'SourceDialog component defined')
check(source.includes("'Add source'") || source.includes('"Add source"'), 'SourceDialog or button has Add source text')
check(source.includes("'Edit source'") || source.includes('"Edit source"'), 'SourceDialog or button has Edit source text')

check(source.includes('handleInitSource'), 'Invalid source has initialize handler')
check(source.includes('Initialize OpenSpec'), 'Invalid source has initialize action')
check(source.includes('initBusy'), 'OpenSpecPage tracks initialization state')
check(source.includes('initError'), 'OpenSpecPage tracks initialization errors')
check(source.includes('Path is required'), 'SourceDialog validates required path')
check(source.includes('function sourceNeedsInitialization'), 'Source add detects missing OpenSpec layout')
check(source.includes('api.initSource(result.source.id)'), 'Source add initializes missing OpenSpec layout')
check(source.includes("source.error === 'No openspec/ directory found'"), 'Source add limits initialization to missing layout')

// Source dialog uses Dialog/DialogContent from SDK
{
  var sdStart = source.indexOf('function SourceDialog')
  var sdEnd = source.indexOf('\nfunction ', sdStart + 1)
  var sdSection = source.slice(sdStart, sdEnd > 0 ? sdEnd : source.length)
  check(sdSection.includes('jsx(Dialog') || sdSection.includes('jsxs(Dialog'), 'SourceDialog renders Dialog')
  check(sdSection.includes('jsx(DialogContent') || sdSection.includes('jsxs(DialogContent'), 'SourceDialog renders DialogContent')
  check(sdSection.includes('jsx(Input'), 'SourceDialog renders Input fields')
  check(sdSection.includes('jsx(Button'), 'SourceDialog renders Button controls')
  check(sdSection.includes('disabled: busy'), 'SourceDialog disables controls while busy')
}

// onClick handlers wired on source action buttons
check(source.includes('onClick: handleEditSource'), 'Edit button has onClick: handleEditSource')
check(source.includes('onClick: handleRemoveSource'), 'Remove button has onClick: handleRemoveSource')
check(source.includes('onClick: handleAddSource'), 'Add button has onClick: handleAddSource')

// Accessible labels on source action buttons
check(source.includes("'aria-label': 'Edit source'"), 'Edit button has aria-label')
check(source.includes("'aria-label': 'Remove source'"), 'Remove button has aria-label')
check(source.includes("'aria-label': 'Add source'"), 'Add button has aria-label')

// State management for source dialog and remove confirmation
check(source.includes('sourceDialog'), 'OpenSpecPage tracks sourceDialog state')
check(source.includes('removeConfirm'), 'OpenSpecPage tracks removeConfirm state')
check(source.includes('removeBusy'), 'OpenSpecPage tracks removeBusy state')
check(source.includes('removeError'), 'OpenSpecPage tracks removeError state')

// Remove confirmation dialog
check(source.includes('Remove source'), 'Remove confirmation dialog exists')
check(source.includes('unregisters the source'), 'Remove confirmation explains registry-only removal')

// Source mutation adapter __test results
if (r.sourceMutation) {
  console.log('  Source mutation adapter')
  check(r.sourceMutation.addSourcePath === '/sources', 'addSource path is /sources', JSON.stringify(r.sourceMutation.addSourcePath))
  check(r.sourceMutation.initSourcePath === '/sources/source%20id/init', 'initSource path encodes source ID', JSON.stringify(r.sourceMutation.initSourcePath))
  check(r.sourceMutation.initSourceMethod === 'POST', 'initSource uses POST', JSON.stringify(r.sourceMutation.initSourceMethod))
  check(r.sourceMutation.initSourceBody === undefined, 'initSource has no request body', JSON.stringify(r.sourceMutation.initSourceBody))
  check(r.sourceMutation.needsInit === true, 'missing OpenSpec layout triggers initialization', JSON.stringify(r.sourceMutation.needsInit))
  check(r.sourceMutation.validNeedsNoInit === false, 'valid source does not trigger initialization', JSON.stringify(r.sourceMutation.validNeedsNoInit))
  check(!r.sourceMutation.error, 'No error in source mutation tests', r.sourceMutation.error)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===')
if (failures.length > 0) {
  console.log('\nFailed tests:')
  for (var i = 0; i < failures.length; i++) {
    console.log('  - ' + failures[i].name + (failures[i].detail ? ': ' + failures[i].detail : ''))
  }
}
process.exit(failed > 0 ? 1 : 0)
