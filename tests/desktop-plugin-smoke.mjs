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

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
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

// ═══════════════════════════════════════════════════════════════════════════════
// Identity/session/interaction driver — self-contained module for fixtures that
// exercise __test helpers and component descriptors (tasks 1.1/1.2/1.4/1.5/1.6).
// The driver is written to a temp file and executed by node; it builds the same
// SDK/react shims as _dynamic_import_helper.mjs, so descriptors carry real
// component references and can be walked structurally.
// ═══════════════════════════════════════════════════════════════════════════════

function runIdentityDriver() {
  const driverPath = join(tmpdir(), 'openspec-identity-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.mjs')
  try {
    writeFileSync(driverPath, IDENTITY_DRIVER, 'utf8')
    const raw = execSync('node ' + driverPath + ' ' + pluginPath, { encoding: 'utf8', timeout: 30000 }).trim()
    return JSON.parse(raw)
  } catch (e) {
    return { __driverError: (e.message || '').slice(0, 800) }
  } finally {
    try { rmSync(driverPath, { force: true }) } catch (e) { /* ignore */ }
  }
}

const IDENTITY_DRIVER = `
import { readFileSync } from 'node:fs'
const pluginSrc = readFileSync(process.argv[2], 'utf8')

const sdkExports = [
  'cn', 'useQuery',
  'Loader', 'EmptyState', 'ErrorState', 'Badge', 'Button',
  'CopyButton', 'Dialog', 'DialogContent', 'Input', 'ScrollArea', 'SearchField',
  'Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue',
  'SegmentedControl', 'Tabs', 'TabsList', 'TabsTrigger'
].map(n => 'export const ' + n + '=(...a)=>a').join(';')
const sdkShim = sdkExports
  + ';export const ROUTES_AREA="routes"'
  + ';export const SIDEBAR_NAV_AREA="sidebar.nav"'
  + ';export default {}'
const reactShim = 'export function useState(v){return[v,function(){},function(){},v]};'
  + 'export function useEffect(f,d){return undefined};'
  + 'export function useRef(v){return{current:v}};'
  + 'export function useCallback(f,d){return f};'
  + 'export function useMemo(f,d){return f()};'
  + 'export function useContext(c){return undefined};'
  + 'export default {}'
const jsxShim = 'export function jsx(c,p){return{component:c,props:p,_t:"jsx"}}'
  + 'export function jsxs(c,p){return{component:c,props:p,_t:"jsxs"}}'
  + 'export function Fragment(p){return p&&p.children}'

const sdkUrl = 'data:text/javascript,' + encodeURIComponent(sdkShim)
const reactUrl = 'data:text/javascript,' + encodeURIComponent(reactShim)
const jsxUrl = 'data:text/javascript,' + encodeURIComponent(jsxShim)
const sdkMod = await import(sdkUrl)

const blobSrc = pluginSrc
  .replace(/from\\s+['"]@hermes\\/plugin-sdk['"]/g, "from '" + sdkUrl + "'")
  .replace(/from\\s+['"]react\\/jsx-runtime['"]/g, "from '" + jsxUrl + "'")
  .replace(/from\\s+['"]react['"]/g, "from '" + reactUrl + "'")
const mod = await import('data:text/javascript,' + encodeURIComponent(blobSrc))
const t = mod.__test
const plugin = mod.default

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (node._t) visit(node)
  var ch = node.props && node.props.children
  if (Array.isArray(ch)) { for (var i = 0; i < ch.length; i++) walk(ch[i], visit) }
  else if (ch && typeof ch === 'object') walk(ch, visit)
}
function collectButtons(node) {
  var out = []
  walk(node, function(n) { if (n.component === sdkMod.CopyButton) out.push(n.props) })
  return out
}
function findByStyle(node, styleKey, styleValue) {
  var out = []
  walk(node, function(n) {
    var st = n.props && n.props.style
    if (st && st[styleKey] === styleValue) out.push(n)
  })
  return out
}

const results = {}

// ---- 1.1 source references ----
const SRC = { id: 'src-ivault', token: 'os_8e5049', name: 'ivault', path: '/repos/ivault' }
const SRC_DUP = { id: 'src-other', token: 'os_dup01', name: 'Ivault', path: '/repos/other' }
const SRC_BLANK = { id: 'src-blank', token: 'os_8e5049', name: '   ', path: '/repos/blank' }
const SRC_ID_ONLY = { id: 'src-id-only', token: '', name: '', path: '/repos/id' }
const SRC_NOTHING = { id: '', token: '', name: '', path: '/repos/nothing' }
const SRC_UNIQUE = { id: 'src-unique', token: 'os_u1', name: 'ivault', path: '/repos/u' }
const SRC_OTHER = { id: 'src-o2', token: 'os_u2', name: 'other', path: '/repos/o' }
results.src = {}
results.src.unique = t.buildSourceReference ? t.buildSourceReference(SRC_UNIQUE, [SRC_UNIQUE, SRC_OTHER]) : null
results.src.caseInsensitiveDup = t.buildSourceReference ? t.buildSourceReference(SRC, [SRC, SRC_DUP]) : null
results.src.blankName = t.buildSourceReference ? t.buildSourceReference(SRC_BLANK, [SRC_BLANK]) : null
results.src.tokenFallback = t.buildSourceReference ? t.buildSourceReference(SRC_ID_ONLY, [SRC_ID_ONLY]) : null
results.src.unavailable = t.buildSourceReference ? t.buildSourceReference(SRC_NOTHING, [SRC_NOTHING]) : null

// ---- 1.2 item references ----
const ITEM_ACTIVE = { token: 'os_fd3445', name: 'hermes-desktop-ui-corrections', status: 'in-progress' }
const ITEM_ARCHIVED = { token: 'os_fd3445', name: 'archived-change', status: 'archived' }
const ITEM_IDEA = { token: 'os_1655dd', name: 'hermes-agentmail-inbox-integration', status: 'ideas' }
const ITEM_NO_TOKEN = { name: 'no-token-change' }
const ITEM_DUP_A = { token: 'os_dup', name: 'dup-a' }
const ITEM_DUP_B = { token: 'os_dup', name: 'dup-b' }
results.item = {}
results.item.active = t.buildItemReference ? t.buildItemReference(SRC, ITEM_ACTIVE, [SRC]) : null
results.item.archived = t.buildItemReference ? t.buildItemReference(SRC, ITEM_ARCHIVED, [SRC]) : null
results.item.idea = t.buildItemReference ? t.buildItemReference(SRC, ITEM_IDEA, [SRC]) : null
results.item.missingToken = t.buildItemReference ? t.buildItemReference(SRC, ITEM_NO_TOKEN, [SRC]) : null
results.item.missingSourceRef = t.buildItemReference ? t.buildItemReference(SRC_NOTHING, ITEM_ACTIVE, [SRC]) : null
results.item.literalNoEncoding = t.buildItemReference ? t.buildItemReference({ id: 'x', token: 'os_1', name: 'My Source' }, { token: 'tok/a b' }, [{ id: 'x', token: 'os_1', name: 'My Source' }]) : null
results.item.uniqueToken = t.hasUniqueItemToken ? t.hasUniqueItemToken(ITEM_DUP_A, [ITEM_DUP_A]) : null
results.item.duplicateToken = t.hasUniqueItemToken ? t.hasUniqueItemToken(ITEM_DUP_A, [ITEM_DUP_A, ITEM_DUP_B]) : null
results.item.blankToken = t.hasUniqueItemToken ? t.hasUniqueItemToken({ token: '' }, []) : null

// ---- 1.4 session store ----
results.session = {}
const freshStore = t.createSessionStore ? t.createSessionStore() : null
results.session.defaultArchived = !!(freshStore && freshStore.showArchived === true)
results.session.defaultSelected = !!(freshStore && freshStore.selectedSourceId === null)
const contribs = []
const regCtx = {
  register: function(c) { contribs.push(c) },
  registerMany: function(arr) { for (var i = 0; i < arr.length; i++) contribs.push(arr[i]) },
  rest: function() { return Promise.resolve({}) }
}
plugin.register(regCtx)
const route = contribs.find(function(c) { return c.area === 'routes' })
const firstRender = route && typeof route.render === 'function' ? route.render() : null
const storeA = firstRender && firstRender.props && firstRender.props.sessionStore
results.session.storeWired = !!storeA
if (storeA) {
  storeA.selectedSourceId = 'os_retained'
  storeA.showArchived = false
  const secondRender = route.render()
  const storeB = secondRender && secondRender.props && secondRender.props.sessionStore
  results.session.sameStoreAcrossRenders = storeB === storeA
  results.session.retainedMutated = !!(storeB && storeB.selectedSourceId === 'os_retained' && storeB.showArchived === false)
}
results.session.fallback = {}
const FS = [ { id: 'a', valid: false, name: 'bad' }, { id: 'b', valid: true, name: 'good' } ]
results.session.fallback.retainedPresentInvalid = t.resolveRetainedSource ? t.resolveRetainedSource(FS, 'a') : null
results.session.fallback.retainedPresentValid = t.resolveRetainedSource ? t.resolveRetainedSource(FS, 'b') : null
results.session.fallback.retainedAbsent = t.resolveRetainedSource ? t.resolveRetainedSource(FS, 'zzz') : null
results.session.fallback.allInvalidFirstReturned = t.resolveRetainedSource ? t.resolveRetainedSource([{ id: 'x', valid: false }], 'zzz') : null
results.session.fallback.noSources = t.resolveRetainedSource ? t.resolveRetainedSource([], 'zzz') : null

// ---- 1.5 detail fallbacks + card descriptors ----
results.detail = {}
results.detail.titleLoaded = t.detailTitle ? t.detailTitle({ title: 'Loaded' }, { title: 'Summary' }, { name: 'Item' }, 'change') : null
results.detail.titleSummary = t.detailTitle ? t.detailTitle({}, { title: 'Summary' }, { name: 'Item' }, 'change') : null
results.detail.titleItem = t.detailTitle ? t.detailTitle({}, {}, { name: 'Item' }, 'change') : null
results.detail.titleUntitledChange = t.detailTitle ? t.detailTitle({}, {}, {}, 'change') : null
results.detail.titleUntitledIdea = t.detailTitle ? t.detailTitle({}, {}, {}, 'idea') : null
results.detail.secondaryLoaded = t.detailSecondaryName ? t.detailSecondaryName({ name: 'Loaded' }, { name: 'Summary' }) : null
results.detail.secondarySummary = t.detailSecondaryName ? t.detailSecondaryName({}, { name: 'Summary' }) : null
results.detail.secondaryMissing = t.detailSecondaryName ? t.detailSecondaryName({}, {}) : null
results.detail.ideaFilename = t.ideaSecondaryName ? t.ideaSecondaryName('hermes-agentmail-inbox-integration') : null
results.detail.ideaFilenameNoDup = t.ideaSecondaryName ? t.ideaSecondaryName('already.md') : null
results.detail.ideaFilenameMissing = t.ideaSecondaryName ? t.ideaSecondaryName('') : null

const CARD_ITEM = { token: 'os_fd3445', name: 'hermes-desktop-ui-corrections', title: 'UI Fixes', status: 'in-progress', hasProposal: true, hasTasks: true, hasDesign: false, hasSpecs: true, taskStats: { done: 2, total: 5 }, sequence: 3 }
const CARD_ALL = [CARD_ITEM, ITEM_IDEA]
const cardNode = t.BoardCard ? t.BoardCard({ item: CARD_ITEM, source: SRC, allSources: [SRC], allItems: CARD_ALL, onSelect: function() {} }) : null
results.card = {}
if (cardNode) {
  const cbs = collectButtons(cardNode)
  results.card.copyCount = cbs.length
  results.card.copyText = cbs[0] && cbs[0].text
  results.card.copyLabel = cbs[0] && cbs[0].label
  results.card.copyTitle = cbs[0] && cbs[0].title
  results.card.copyStopProp = !!(cbs[0] && cbs[0].stopPropagation === true)
  results.card.tabIndexZero = cardNode.props.tabIndex === 0
  results.card.roleButton = cardNode.props.role === 'button'
  results.card.hasKeyDown = typeof cardNode.props.onKeyDown === 'function'
  results.card.rightGroupAuto = findByStyle(cardNode, 'marginLeft', 'auto').length > 0
  results.card.tokenVisible = JSON.stringify(cardNode).includes('os_fd3445')
  results.card.leftGroupHasArtifacts = (function() {
    var found = false
    walk(cardNode, function(n) { if (n.component && n.component.name === 'CardArtifacts') found = true })
    return found
  })()
  results.card.leftGroupHasFraction = (function() {
    var found = false
    walk(cardNode, function(n) { if (n.component && n.component.name === 'CardTaskFraction') found = true })
    return found
  })()
  results.card.taskFraction = t.CardTaskFraction ? JSON.stringify(t.CardTaskFraction({ item: CARD_ITEM })).includes('2/5 tasks') : null
  results.card.leftBadges = t.CardArtifacts ? JSON.stringify(t.CardArtifacts({ item: CARD_ITEM })).includes('proposal') && JSON.stringify(t.CardArtifacts({ item: CARD_ITEM })).includes('tasks') : null
  results.card.statusBorder = !!(cardNode.props.style && cardNode.props.style.borderLeftColor)
  results.card.hoverExactCard = (function() {
    var cnv = cardNode && cardNode.props && cardNode.props.className
    if (!cnv) return false
    var cls = Array.isArray(cnv) ? cnv.join(' ') : String(cnv)
    return cls.includes('hover:bg-primary/[0.06]')
  })()
  results.card.hoverGenericAbsent = (function() {
    var cnv = cardNode && cardNode.props && cardNode.props.className
    if (!cnv) return true
    var cls = Array.isArray(cnv) ? cnv.join(' ') : String(cnv)
    return !cls.includes('--ui-hover-background')
  })()
}

const SPARSE_ITEM = { token: 'os_x1', name: 'bare-card' }
const sparseNode = t.BoardCard ? t.BoardCard({ item: SPARSE_ITEM, source: SRC, allSources: [SRC], allItems: [SPARSE_ITEM], onSelect: function() {} }) : null
results.sparse = {}
if (sparseNode) {
  const scbs = collectButtons(sparseNode)
  results.sparse.copyText = scbs[0] && scbs[0].text
  results.sparse.noPlaceholderFraction = !JSON.stringify(sparseNode).includes('0/0')
  results.sparse.rightGroupAuto = findByStyle(sparseNode, 'marginLeft', 'auto').length > 0
  results.sparse.tokenVisible = JSON.stringify(sparseNode).includes('os_x1')
}

const dupNode = t.BoardCard ? t.BoardCard({ item: ITEM_DUP_A, source: SRC, allSources: [SRC], allItems: [ITEM_DUP_A, ITEM_DUP_B], onSelect: function() {} }) : null
results.dupCard = {}
if (dupNode) {
  results.dupCard.copySuppressed = collectButtons(dupNode).length === 0
  results.dupCard.tokenStillVisible = JSON.stringify(dupNode).includes('os_dup')
}

// ---- 1.6 keyboard + collapsed rail ----
results.keyboard = {}
let enterCount = 0, spaceCount = 0, otherCount = 0, spacePrevented = false
if (t.handleActivateKey) {
  t.handleActivateKey({ key: 'Enter', preventDefault: function() {} }, function() { enterCount++ })
  t.handleActivateKey({ key: ' ', preventDefault: function() { spacePrevented = true } }, function() { spaceCount++ })
  t.handleActivateKey({ key: 'a' }, function() { otherCount++ })
}
results.keyboard.enterActivatesOnce = enterCount === 1
results.keyboard.spaceActivatesOnce = spaceCount === 1
results.keyboard.spacePreventsDefault = spacePrevented === true
results.keyboard.otherKeysIgnored = otherCount === 0

const railNode = t.BoardColumn ? t.BoardColumn({ status: 'todo', items: [], source: SRC, allSources: [SRC], allItems: [], onSelect: function() {}, collapsed: true, onExpand: function() {} }) : null
results.rail = {}
if (railNode) {
  results.rail.tabIndexZero = railNode.props.tabIndex === 0
  results.rail.roleButton = railNode.props.role === 'button'
  results.rail.hasKeyDown = typeof railNode.props.onKeyDown === 'function'
  results.rail.dotTonePresent = JSON.stringify(railNode).includes('var(--ui-text-secondary)')
  results.rail.hoverExactRail = (function() {
    var cnv = railNode && railNode.props && railNode.props.className
    if (!cnv) return false
    var cls = Array.isArray(cnv) ? cnv.join(' ') : String(cnv)
    return cls.includes('hover:bg-(--ui-bg-quinary)')
  })()
  results.rail.hoverGenericAbsent = (function() {
    var cnv = railNode && railNode.props && railNode.props.className
    if (!cnv) return true
    var cls = Array.isArray(cnv) ? cnv.join(' ') : String(cnv)
    return !cls.includes('--ui-hover-background')
  })()
}

// ---- 1.4b retained-source restoration across the loading window ----
// Executes the real OpenSpecPage body (not just descriptors) with controllable
// useQuery/useState/useEffect shims to simulate the cold-cache remount sequence:
//   mount with retained id while sourcesQuery.data is undefined (loading),
//   then refreshed /sources data arrives.
const shimHooks = globalThis.__openspecHooks = { hookIdx: 0, stateReg: [], effects: [], lastDeps: [] }
const queryBox = globalThis.__openspecQuery = { data: undefined, isLoading: true, error: null }

const sdkShim2 = [
  'cn', 'Loader', 'EmptyState', 'ErrorState', 'Badge', 'Button',
  'CopyButton', 'Dialog', 'DialogContent', 'Input', 'ScrollArea', 'SearchField',
  'Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue',
  'SegmentedControl', 'Tabs', 'TabsList', 'TabsTrigger'
].map(n => 'export const ' + n + '=(...a)=>a').join(';')
  + ';export const useQuery=(o)=>globalThis.__openspecQuery'
  + ';export const ROUTES_AREA="routes"'
  + ';export const SIDEBAR_NAV_AREA="sidebar.nav"'
  + ';export default {}'
const reactShim2 = 'export function useState(v){const i=globalThis.__openspecHooks.hookIdx++;if(globalThis.__openspecHooks.stateReg[i]===undefined)globalThis.__openspecHooks.stateReg[i]={v:v};const box=globalThis.__openspecHooks.stateReg[i];const set=function(nv){box.v=typeof nv==="function"?nv(box.v):nv};return[box.v,set]};'
  + 'export function useEffect(f,d){globalThis.__openspecHooks.effects.push({f:f,d:d});return undefined};'
  + 'export function useRef(v){return{current:v}};'
  + 'export function useCallback(f,d){return f};'
  + 'export function useMemo(f,d){return f()};'
  + 'export function useContext(c){return undefined};'
  + 'export default {useState:useState,useEffect:useEffect,useRef:useRef,useCallback:useCallback,useMemo:useMemo,useContext:useContext}'

const sdkUrl2 = 'data:text/javascript,' + encodeURIComponent(sdkShim2)
const reactUrl2 = 'data:text/javascript,' + encodeURIComponent(reactShim2)
const sdkMod2 = await import(sdkUrl2)
const blobSrc2 = pluginSrc
  .replace(/from\\s+['"]@hermes\\/plugin-sdk['"]/g, "from '" + sdkUrl2 + "'")
  .replace(/from\\s+['"]react\\/jsx-runtime['"]/g, "from '" + jsxUrl + "'")
  .replace(/from\\s+['"]react['"]/g, "from '" + reactUrl2 + "'")

results.mount = {}
try {
  const mod2 = await import('data:text/javascript,' + encodeURIComponent(blobSrc2))
  const plugin2 = mod2.default
  const contribs2 = []
  plugin2.register({ register: function(c) { contribs2.push(c) }, registerMany: function(arr) { for (var i = 0; i < arr.length; i++) contribs2.push(arr[i]) }, rest: function() { return Promise.resolve({}) } })
  const route2 = contribs2.find(function(c) { return c.area === 'routes' })
  const page2 = route2.render()
  const OpenSpecPage2 = page2.component
  const api2 = {
    sources: function() { return queryBox.data ? queryBox.data : { sources: [] } },
    initSource: function() { return Promise.resolve({}) },
    removeSource: function() { return Promise.resolve({}) },
    updateSource: function() { return Promise.resolve({}) }
  }

  function sameDeps(a, b) {
    if (a === b) return true
    if (!a || !b || a.length !== b.length) return false
    for (var i = 0; i < a.length; i++) { if (!Object.is(a[i], b[i])) return false }
    return true
  }
  function renderPage(store) {
    shimHooks.hookIdx = 0
    const effStart = shimHooks.effects.length
    const node = OpenSpecPage2({ api: api2, sessionStore: store })
    for (var i = effStart; i < shimHooks.effects.length; i++) {
      const e = shimHooks.effects[i]
      const prev = shimHooks.lastDeps[i]
      if (prev === undefined || !sameDeps(prev, e.d)) e.f()
    }
    shimHooks.lastDeps = shimHooks.effects.map(function(e) { return e.d })
    return node
  }
  function mountSequence(retainedId, phases) {
    shimHooks.hookIdx = 0; shimHooks.stateReg = []; shimHooks.effects = []; shimHooks.lastDeps = []
    const store = t.createSessionStore()
    store.selectedSourceId = retainedId
    const out = {}
    for (var p = 0; p < phases.length; p++) {
      queryBox.data = phases[p].data
      queryBox.isLoading = phases[p].isLoading !== false
      queryBox.error = phases[p].error || null
      const node = renderPage(store)
      out['phase' + (p + 1)] = {
        store: store.selectedSourceId,
        state: shimHooks.stateReg[0] ? shimHooks.stateReg[0].v : undefined,
        component: node && node.component ? (node.component.name || 'anon') : 'none'
      }
    }
    return out
  }

  const SRC_A = { id: 'src-a', token: 'os_a', name: 'alpha', valid: false }
  const SRC_B = { id: 'src-b', token: 'os_b', name: 'beta', valid: true }
  const SRC_C = { id: 'src-c', token: 'os_c', name: 'gamma', valid: false }
  const populated = { sources: [SRC_A, SRC_B] }
  const populatedWithC = { sources: [SRC_A, SRC_B, SRC_C] }
  const empty = { sources: [] }

  // Retained valid source survives the loading window and stays selected.
  results.mount.retainedValid = mountSequence('src-b', [
    { data: undefined, isLoading: true }, { data: populated, isLoading: false }
  ])
  // Registered invalid source remains selected after data arrival.
  results.mount.retainedInvalid = mountSequence('src-c', [
    { data: undefined, isLoading: true }, { data: populatedWithC, isLoading: false }
  ])
  // Absent retained source falls back to first valid against the refreshed list.
  results.mount.retainedAbsent = mountSequence('zzz', [
    { data: undefined, isLoading: true }, { data: populated, isLoading: false }
  ])
  // Genuinely empty refreshed result resolves to null — only after data arrives.
  results.mount.genuinelyEmpty = mountSequence('src-b', [
    { data: undefined, isLoading: true }, { data: empty, isLoading: false }
  ])

  // ---- 3.6 remediation: source copy control immediately before source name ----
  results.sourceRow = {}
  try {
    shimHooks.hookIdx = 0; shimHooks.stateReg = []; shimHooks.effects = []; shimHooks.lastDeps = []
    const store3 = t.createSessionStore()
    store3.selectedSourceId = SRC_B.id
    queryBox.data = populated
    queryBox.isLoading = false
    queryBox.error = null
    const rowNode = renderPage(store3)
    const ordered = []
    walk(rowNode, function(n) { ordered.push(n) })
    const copyIdx = ordered.findIndex(function(n) { return n.component === sdkMod2.CopyButton && n.props && n.props.label === 'Copy source reference' })
    const nameIdx = ordered.findIndex(function(n) { return n.props && n.props.children === SRC_B.name && n.props.style && n.props.style.fontWeight === 600 })
    results.sourceRow.copyIndex = copyIdx
    results.sourceRow.nameIndex = nameIdx
    results.sourceRow.copyImmediatelyBeforeName = copyIdx >= 0 && nameIdx >= 0 && copyIdx + 1 === nameIdx
  } catch (e) {
    results.sourceRow.__error = (e && e.message ? e.message : String(e)).slice(0, 800)
  }
} catch (e) {
  results.mount.__error = (e && e.message ? e.message : String(e)).slice(0, 800)
}

console.log(JSON.stringify(results))
`

const identity = runIdentityDriver()

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

// 6b. SpecsView: source-matching gate — component remounts via key prop
{
  const specsStart = source.indexOf('function SpecsView')
  const nextFnSpecs = source.indexOf('\nfunction ', specsStart + 1)
  const specsSection = source.slice(specsStart, nextFnSpecs > 0 ? nextFnSpecs : source.length)
  check(!specsSection.includes('selectedSourceId'),
    'SpecsView no longer tracks selectedSourceId (removed dead code)')
  check(!specsSection.match(/enabled:.*selectedSourceId\s*===\s*sourceId/),
    'specQuery enabled no longer gates on selectedSourceId match')
  check(!specsSection.includes('setSelectedSourceId'),
    'SpecsView no longer calls setSelectedSourceId (removed dead code)')
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

// 11. Dialog close button / scrollbar overlap fix
// ChangeDetailDialog and IdeaDetailDialog must use overflowY (not overflow) and
// paddingRight to prevent the close X from overlapping the scrollbar at the top edge.
{
  var cdStart = source.indexOf('function ChangeDetailDialog')
  var cdEnd = source.indexOf('\nfunction ', cdStart + 1)
  var cdSection = source.slice(cdStart, cdEnd > 0 ? cdEnd : source.length)
  check(cdSection.includes('overflowY'), 'ChangeDetailDialog uses overflowY (not overflow) to avoid close/scrollbar overlap')
  check(cdSection.includes("'2rem'"), 'ChangeDetailDialog has paddingRight: 2rem for close button clearance')
}
{
  var idStart = source.indexOf('function IdeaDetailDialog')
  var idEnd = source.indexOf('\nfunction ', idStart + 1)
  var idSection = source.slice(idStart, idEnd > 0 ? idEnd : source.length)
  check(idSection.includes('overflowY'), 'IdeaDetailDialog uses overflowY (not overflow) to avoid close/scrollbar overlap')
  check(idSection.includes("'2rem'"), 'IdeaDetailDialog has paddingRight: 2rem for close button clearance')
}
// No scrollable DialogContent should use overflow: 'auto' (causes close X / scrollbar overlap)
{
  var overflowAutoMatches = source.match(/DialogContent[^}]*overflow:\s*'auto'/g)
  check(!overflowAutoMatches, 'No DialogContent uses overflow: auto (causes close/scrollbar overlap)')
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
  check(bcSection.includes('text: itemRef'), 'BoardCard CopyButton uses text prop (not value)')
  check(!bcSection.includes('value: itemRef'), 'BoardCard CopyButton does not use value prop')
}

// Detail CopyButton should NOT have stopPropagation (not inside clickable card)
{
  var cdStart = source.indexOf('function ChangeDetailDialog')
  var cdEnd = source.indexOf('\nfunction ', cdStart + 1)
  var cdSection = source.slice(cdStart, cdEnd > 0 ? cdEnd : source.length)
  check(cdSection.includes('text: itemRef'), 'ChangeDetailDialog CopyButton uses text prop')
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
// [Identity 1.1] Resolver-safe source references
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Identity 1.1] Resolver-safe source references')

check(source.includes('function buildSourceReference'), 'buildSourceReference helper defined')
check(source.includes('buildSourceReference: buildSourceReference'), 'buildSourceReference exported via __test')

{
  const s = identity && identity.src ? identity.src : {}
  check(s.unique === 'ivault', 'Unique source name copies the vanity name', JSON.stringify(s.unique))
  check(s.caseInsensitiveDup === 'os_8e5049', 'Case-insensitive duplicate name falls back to stable token', JSON.stringify(s.caseInsensitiveDup))
  check(s.blankName === 'os_8e5049', 'Blank source name falls back to stable token', JSON.stringify(s.blankName))
  check(s.tokenFallback === 'src-id-only', 'Missing name falls back to stable id', JSON.stringify(s.tokenFallback))
  check(s.unavailable === '', 'Unavailable reference returns empty string (no malformed copy)', JSON.stringify(s.unavailable))
}

// Reference helpers never construct paths or encode
{
  const start = source.indexOf('function buildSourceReference')
  const end = source.indexOf('function computeCollapsedSet')
  const refSec = source.slice(start, end > start ? end : source.length)
  check(refSec.length > 0, 'Reference helper section present')
  check(!refSec.includes('.path'), 'Reference helpers never use source.path', refSec.includes('.path') ? 'found .path usage' : undefined)
  check(!refSec.includes('encodeURIComponent'), 'Reference helpers perform no URL encoding')
}

// ═══════════════════════════════════════════════════════════════════════════════
// [Identity 1.2] Resolver-safe item references
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Identity 1.2] Resolver-safe item references')

{
  const it = identity && identity.item ? identity.item : {}
  check(it.active === 'ivault/os_fd3445', 'Active change reference is source-qualified', JSON.stringify(it.active))
  check(it.archived === 'ivault/os_fd3445', 'Archived change reference is identical (no archive segment)', JSON.stringify(it.archived))
  check(it.idea === 'ivault/os_1655dd', 'Idea reference is source-qualified', JSON.stringify(it.idea))
  check(it.missingToken === '', 'Missing item token produces no reference', JSON.stringify(it.missingToken))
  check(it.missingSourceRef === '', 'Unavailable source reference produces no item reference', JSON.stringify(it.missingSourceRef))
  check(it.literalNoEncoding === 'My Source/tok/a b', 'Names and tokens preserved literally without encoding', JSON.stringify(it.literalNoEncoding))
  check(it.uniqueToken === true, 'Unique item token is copy-available', JSON.stringify(it.uniqueToken))
  check(it.duplicateToken === false, 'Duplicate item token is not copy-available', JSON.stringify(it.duplicateToken))
  check(it.blankToken === false, 'Blank item token is not copy-available', JSON.stringify(it.blankToken))
}

// ═══════════════════════════════════════════════════════════════════════════════
// [Session 1.4] Registration-scope navigation state
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Session 1.4] Registration-scope session store')

{
  const ses = identity && identity.session ? identity.session : {}
  check(ses.defaultArchived === true, 'Fresh session store defaults Archived to true', JSON.stringify(ses.defaultArchived))
  check(ses.defaultSelected === true, 'Fresh session store defaults selectedSourceId to null', JSON.stringify(ses.defaultSelected))
  check(ses.storeWired === true, 'register() passes session store into route render', JSON.stringify(ses.storeWired))
  check(ses.sameStoreAcrossRenders === true, 'Second route render reads same registration-scope store', JSON.stringify(ses.sameStoreAcrossRenders))
  check(ses.retainedMutated === true, 'Store mutations survive route-local state discard', JSON.stringify(ses.retainedMutated))
  const fb = ses.fallback || {}
  check(fb.retainedPresentInvalid === 'a', 'Retained invalid source stays selected while registered', JSON.stringify(fb.retainedPresentInvalid))
  check(fb.retainedPresentValid === 'b', 'Retained valid source stays selected', JSON.stringify(fb.retainedPresentValid))
  check(fb.retainedAbsent === 'b', 'Absent retained source falls back to first valid', JSON.stringify(fb.retainedAbsent))
  check(fb.allInvalidFirstReturned === 'x', 'All-invalid sources fall back to first returned', JSON.stringify(fb.allInvalidFirstReturned))
  check(fb.noSources === null, 'No sources resolve to null selection', JSON.stringify(fb.noSources))
}

// ═══════════════════════════════════════════════════════════════════════════════
// [Session 1.4b] Retained-source restoration across the loading window
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Session 1.4b] Retained-source restoration across the loading window')

{
  const m = identity && identity.mount ? identity.mount : {}
  check(m.__error === undefined, 'Mount-sequence simulation executed without driver error', m.__error || '')
  const rv = m.retainedValid || {}
  check(rv.phase1 && rv.phase1.store === 'src-b', 'Loading window does not wipe retained selection (store)', JSON.stringify(rv.phase1))
  check(rv.phase1 && rv.phase1.state === 'src-b', 'Loading window does not wipe retained selection (state)', JSON.stringify(rv.phase1))
  check(rv.phase1 && rv.phase1.component === 'Loader', 'Loading phase renders the loader', JSON.stringify(rv.phase1))
  check(rv.phase2 && rv.phase2.store === 'src-b', 'Retained valid source survives remount after data arrival', JSON.stringify(rv.phase2))
  check(rv.phase2 && rv.phase2.state === 'src-b', 'Retained valid source stays selected in React state', JSON.stringify(rv.phase2))
  const ri = m.retainedInvalid || {}
  check(ri.phase2 && ri.phase2.store === 'src-c', 'Registered invalid source remains selected after data arrival', JSON.stringify(ri.phase2))
  check(ri.phase2 && ri.phase2.state === 'src-c', 'Registered invalid source stays selected in React state', JSON.stringify(ri.phase2))
  const ra = m.retainedAbsent || {}
  check(ra.phase2 && ra.phase2.store === 'src-b', 'Absent retained source falls back to first valid against refreshed list', JSON.stringify(ra.phase2))
  check(ra.phase2 && ra.phase2.state === 'src-b', 'Absent-retained fallback lands in React state too', JSON.stringify(ra.phase2))
  const ge = m.genuinelyEmpty || {}
  check(ge.phase1 && ge.phase1.store === 'src-b', 'Retained id survives the loading render before empty result', JSON.stringify(ge.phase1))
  check(ge.phase2 && ge.phase2.store === null, 'Genuinely empty refreshed result resolves to null selection', JSON.stringify(ge.phase2))
  check(ge.phase2 && ge.phase2.state === null, 'Empty-result null resolution lands in React state too', JSON.stringify(ge.phase2))
}

// Static wiring — store created in register(), owned by OpenSpecPage
{
  const regStart = source.indexOf('register: function')
  const regEnd = source.indexOf('\n}', regStart + 1)
  const regSec = source.slice(regStart, regEnd > 0 ? regEnd : source.length)
  check(regSec.includes('createSessionStore'), 'register() creates the session store')
  check(regSec.includes('sessionStore'), 'register() passes session store to OpenSpecPage')
}
{
  const ppStart = source.indexOf('function OpenSpecPage')
  const ppEnd = source.indexOf('\nfunction ', ppStart + 1)
  const ppSec = source.slice(ppStart, ppEnd > 0 ? ppEnd : source.length)
  check(ppSec.includes('sessionStore.selectedSourceId'), 'OpenSpecPage initializes selection from session store')
  check(ppSec.includes('sessionStore.showArchived'), 'OpenSpecPage initializes Archived from session store')
  check(ppSec.includes('sessionStore.selectedSourceId ='), 'Explicit source selection writes session store')
  check(ppSec.includes('sessionStore.showArchived ='), 'Archived toggle writes session store')
  check(ppSec.includes('resolveRetainedSource'), 'OpenSpecPage applies retained-source fallback rules')
  check(ppSec.includes('sourcesQuery.data === undefined'), 'Resolution effect is gated on data arrival (loading window safe)')
  check(ppSec.includes('sourcesQuery.data, selectedSourceId'), 'Resolution effect re-runs when refreshed data arrives')
  check(ppSec.includes('onToggleArchived'), 'WorkView receives controlled Archived toggle prop')
}

// ═══════════════════════════════════════════════════════════════════════════════
// [Identity 1.5] Copy controls, detail identity, footer layout
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Identity 1.5] Copy controls, detail identity, footer layout')

{
  const dt = identity && identity.detail ? identity.detail : {}
  check(dt.titleLoaded === 'Loaded', 'Detail title prefers loaded detail title', JSON.stringify(dt.titleLoaded))
  check(dt.titleSummary === 'Summary', 'Detail title falls back to selected summary title', JSON.stringify(dt.titleSummary))
  check(dt.titleItem === 'Item', 'Detail title falls back to item name', JSON.stringify(dt.titleItem))
  check(dt.titleUntitledChange === 'Untitled change', 'Change title falls back to "Untitled change"', JSON.stringify(dt.titleUntitledChange))
  check(dt.titleUntitledIdea === 'Untitled idea', 'Idea title falls back to "Untitled idea"', JSON.stringify(dt.titleUntitledIdea))
  check(dt.secondaryLoaded === 'Loaded', 'Secondary identity prefers loaded detail name', JSON.stringify(dt.secondaryLoaded))
  check(dt.secondarySummary === 'Summary', 'Secondary identity falls back to summary name', JSON.stringify(dt.secondarySummary))
  check(dt.secondaryMissing === '', 'Missing secondary identity is omitted', JSON.stringify(dt.secondaryMissing))
  check(dt.ideaFilename === 'hermes-agentmail-inbox-integration.md', 'Idea secondary identity appends .md exactly once', JSON.stringify(dt.ideaFilename))
  check(dt.ideaFilenameNoDup === 'already.md', 'Existing .md suffix is not duplicated', JSON.stringify(dt.ideaFilenameNoDup))
  check(dt.ideaFilenameMissing === '', 'Missing idea identity is omitted', JSON.stringify(dt.ideaFilenameMissing))
}

{
  const cd = identity && identity.card ? identity.card : {}
  check(cd.copyCount === 1, 'Card renders exactly one copy control when available', JSON.stringify(cd.copyCount))
  check(cd.copyText === 'ivault/os_fd3445', 'Card CopyButton.text equals canonical item reference', JSON.stringify(cd.copyText))
  check(cd.copyLabel === 'Copy item reference', 'Card copy accessible label is "Copy item reference"', JSON.stringify(cd.copyLabel))
  check(cd.copyTitle === 'ivault/os_fd3445', 'Card copy tooltip equals exact clipboard payload', JSON.stringify(cd.copyTitle))
  check(cd.copyStopProp === true, 'Card copy stops propagation inside clickable card', JSON.stringify(cd.copyStopProp))
  check(cd.rightGroupAuto === true, 'Identity group pinned lower-right with margin-left auto', JSON.stringify(cd.rightGroupAuto))
  check(cd.tokenVisible === true, 'Short token visible as metadata on card', JSON.stringify(cd.tokenVisible))
  check(cd.leftGroupHasArtifacts === true, 'Artifact badges occupy left footer group', JSON.stringify(cd.leftGroupHasArtifacts))
  check(cd.leftGroupHasFraction === true, 'Task fraction occupies left footer group', JSON.stringify(cd.leftGroupHasFraction))
  check(cd.leftBadges === true, 'Populated card renders proposal/tasks badges', JSON.stringify(cd.leftBadges))
  check(cd.taskFraction === true, 'Task fraction stays in populated footer', JSON.stringify(cd.taskFraction))
  check(cd.statusBorder === true, 'Status-colored border preserved on card', JSON.stringify(cd.statusBorder))
  check(cd.hoverExactCard === true, 'Card hover uses exact bundled-Kanban utility hover:bg-primary/[0.06]', JSON.stringify(cd.hoverExactCard))
  check(cd.hoverGenericAbsent === true, 'Card hover no longer uses generic --ui-hover-background', JSON.stringify(cd.hoverGenericAbsent))
}

{
  const sp = identity && identity.sparse ? identity.sparse : {}
  check(sp.copyText === 'ivault/os_x1', 'Sparse card keeps canonical copy reference', JSON.stringify(sp.copyText))
  check(sp.noPlaceholderFraction === true, 'Sparse footer has no placeholder task fraction', JSON.stringify(sp.noPlaceholderFraction))
  check(sp.rightGroupAuto === true, 'Sparse identity group stays lower-right', JSON.stringify(sp.rightGroupAuto))
  check(sp.tokenVisible === true, 'Sparse card keeps visible token metadata', JSON.stringify(sp.tokenVisible))
}

{
  const dc = identity && identity.dupCard ? identity.dupCard : {}
  check(dc.copySuppressed === true, 'Duplicate item token suppresses copy control', JSON.stringify(dc.copySuppressed))
  check(dc.tokenStillVisible === true, 'Visible identity remains when copy suppressed', JSON.stringify(dc.tokenStillVisible))
}

// Detail dialogs and source header wiring
{
  const cdStart = source.indexOf('function ChangeDetailDialog')
  const cdEnd = source.indexOf('\nfunction ', cdStart + 1)
  const cdSec = source.slice(cdStart, cdEnd > 0 ? cdEnd : source.length)
  check(cdSec.includes("'Copy item reference'"), 'Change detail copy label is "Copy item reference"')
  check(cdSec.includes('buildItemReference'), 'Change detail uses canonical item reference')
  check(cdSec.includes('hasUniqueItemToken'), 'Change detail guards copy on unique token')
  check(cdSec.includes('detailTitle'), 'Change detail uses title fallback')
  check(cdSec.includes('detailSecondaryName'), 'Change detail shows secondary folder identity')
}
{
  const idStart = source.indexOf('function IdeaDetailDialog')
  const idEnd = source.indexOf('\nfunction ', idStart + 1)
  const idSec = source.slice(idStart, idEnd > 0 ? idEnd : source.length)
  check(idSec.includes("'Copy item reference'"), 'Idea detail copy label is "Copy item reference"')
  check(idSec.includes('ideaSecondaryName'), 'Idea detail appends .md exactly once')
  check(idSec.includes('detailTitle'), 'Idea detail uses title fallback')
}
{
  const ppStart = source.indexOf('function OpenSpecPage')
  const ppEnd = source.indexOf('\nfunction ', ppStart + 1)
  const ppSec = source.slice(ppStart, ppEnd > 0 ? ppEnd : source.length)
  check(ppSec.includes("'Copy source reference'"), 'Source copy label is "Copy source reference"')
  check(ppSec.includes('buildSourceReference'), 'Source header uses canonical source reference')
  check(ppSec.includes('disabled:'), 'Unavailable source copy is disabled rather than malformed')
  check(ppSec.includes('fontFamily: \'monospace\''), 'Short token renders in monospace metadata element')
}
check(!source.includes('navigator.clipboard'), 'No custom Clipboard API added (SDK CopyButton feedback retained)')

// ═══════════════════════════════════════════════════════════════════════════════
// [Interaction 1.6] Keyboard activation, hover/focus markers
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Interaction 1.6] Keyboard activation and interaction markers')

{
  const kb = identity && identity.keyboard ? identity.keyboard : {}
  check(kb.enterActivatesOnce === true, 'Enter activates action once', JSON.stringify(kb.enterActivatesOnce))
  check(kb.spaceActivatesOnce === true, 'Space activates action once on keydown', JSON.stringify(kb.spaceActivatesOnce))
  check(kb.spacePreventsDefault === true, 'Space prevents default scrolling', JSON.stringify(kb.spacePreventsDefault))
  check(kb.otherKeysIgnored === true, 'Unrelated keys do nothing', JSON.stringify(kb.otherKeysIgnored))
}
{
  const cd = identity && identity.card ? identity.card : {}
  check(cd.tabIndexZero === true, 'Card is keyboard-addressable (tabIndex 0)', JSON.stringify(cd.tabIndexZero))
  check(cd.roleButton === true, 'Card has button semantics', JSON.stringify(cd.roleButton))
  check(cd.hasKeyDown === true, 'Card wires keydown handler', JSON.stringify(cd.hasKeyDown))
}
{
  const rl = identity && identity.rail ? identity.rail : {}
  check(rl.tabIndexZero === true, 'Collapsed rail is keyboard-addressable (tabIndex 0)', JSON.stringify(rl.tabIndexZero))
  check(rl.roleButton === true, 'Collapsed rail has button semantics', JSON.stringify(rl.roleButton))
  check(rl.hasKeyDown === true, 'Collapsed rail wires keydown handler', JSON.stringify(rl.hasKeyDown))
  check(rl.dotTonePresent === true, 'Status dot preserved on collapsed rail', JSON.stringify(rl.dotTonePresent))
  check(rl.hoverExactRail === true, 'Collapsed rail hover uses exact bundled-Kanban utility hover:bg-(--ui-bg-quinary)', JSON.stringify(rl.hoverExactRail))
  check(rl.hoverGenericAbsent === true, 'Collapsed rail hover no longer uses generic --ui-hover-background', JSON.stringify(rl.hoverGenericAbsent))
}
// Static interaction markers — hover/focus-visible + shared handler + status preservation
{
  const bcStart = source.indexOf('function BoardCard')
  const bcEnd = source.indexOf('\nfunction ', bcStart + 1)
  const bcSec = source.slice(bcStart, bcEnd > 0 ? bcEnd : source.length)
  check(bcSec.includes('focus-visible'), 'Card has focus-visible marker')
  check(bcSec.includes('hover:'), 'Card has hover marker')
  check(bcSec.includes('hover:bg-primary/[0.06]'), 'Card hover marker is exact bundled-Kanban utility hover:bg-primary/[0.06]')
  check(!bcSec.includes('--ui-hover-background'), 'Card has no generic --ui-hover-background hover marker')
  check(bcSec.includes('tabIndex: 0'), 'Card sets tabIndex 0')
  check(bcSec.includes('onKeyDown'), 'Card wires onKeyDown')
  check(bcSec.includes('handleActivateKey'), 'Card uses shared Enter/Space handler')
  check(bcSec.includes('borderLeftColor: statusTone(status)'), 'Card keeps status-colored left border')
}
{
  const colStart = source.indexOf('function BoardColumn')
  const colEnd = source.indexOf('\nfunction ', colStart + 1)
  const colSec = source.slice(colStart, colEnd > 0 ? colEnd : source.length)
  check(colSec.includes('focus-visible'), 'Collapsed rail has focus-visible marker')
  check(colSec.includes('hover:bg-(--ui-bg-quinary)'), 'Collapsed rail hover marker is exact bundled-Kanban utility hover:bg-(--ui-bg-quinary)')
  check(!colSec.includes('--ui-hover-background'), 'Collapsed rail has no generic --ui-hover-background hover marker')
  check(colSec.includes('tabIndex: 0'), 'Rail sets tabIndex 0')
  check(colSec.includes('onKeyDown'), 'Rail wires onKeyDown')
  check(colSec.includes('handleActivateKey'), 'Rail uses shared Enter/Space handler')
  check(colSec.includes('backgroundColor: statusTone(status)'), 'Rail keeps status dot')
}

// ═══════════════════════════════════════════════════════════════════════════════
// [Remediation 3.6] Source copy-before-name ordering (deep-rendered)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n[Remediation 3.6] Source copy control order')

{
  const sr = identity && identity.sourceRow ? identity.sourceRow : {}
  check(sr.__error === undefined, 'Source-row deep render executed without error', sr.__error || '')
  check(sr.copyImmediatelyBeforeName === true, 'Source CopyButton renders immediately before visible source name',
    'copyIndex=' + sr.copyIndex + ' nameIndex=' + sr.nameIndex)
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
