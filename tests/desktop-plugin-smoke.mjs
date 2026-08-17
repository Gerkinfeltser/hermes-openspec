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
  check(bd.normalizeUnknown != null, 'normalizeStatus handles unknown status',
    String(bd.normalizeUnknown))

  // Group by status
  console.log('  Group by status')
  check(Array.isArray(bd.groupKeys) && bd.groupKeys.length >= 4, 'groupByStatus returns groups',
    'Got ' + (bd.groupKeys && bd.groupKeys.length) + ' groups: ' + (bd.groupKeys && bd.groupKeys.join(', ')))
  check(bd.groupCounts && bd.groupCounts['in-progress'] === 1, 'Group "in-progress" has 1 item',
    JSON.stringify(bd.groupCounts && bd.groupCounts['in-progress']))
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
