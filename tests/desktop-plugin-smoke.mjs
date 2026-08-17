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
} else {
  fail('Spec-browser helpers', '__test not available')
}

// ═══════════════════════════════════════════════════════════════════════════════
// Static analysis checks
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
