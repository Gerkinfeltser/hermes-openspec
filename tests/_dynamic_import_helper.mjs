#!/usr/bin/env node
/**
 * Helper module for dynamic import shim generation.
 * Called by desktop-plugin-smoke.mjs to avoid template literal escaping issues.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginPath = resolve(__dirname, '../desktop/plugin.js')
const src = readFileSync(pluginPath, 'utf8')

// Shim @hermes/plugin-sdk
const sdkExports = [
  'cn', 'useQuery',
  'Loader', 'EmptyState', 'ErrorState', 'Badge', 'Button',
  'CopyButton', 'Dialog', 'DialogContent', 'Input', 'ScrollArea', 'SearchField',
  'Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue',
  'SegmentedControl', 'Tabs', 'TabsList', 'TabsTrigger'
].map(n => 'export const ' + n + '=(...a)=>a').join(';')
// ROUTES_AREA and SIDEBAR_NAV_AREA are string constants, not functions
const sdkShim = sdkExports
  + ';export const ROUTES_AREA="routes"'
  + ';export const SIDEBAR_NAV_AREA="sidebar.nav"'
  + ';export default {}'

// Shim react
const reactShim = 'export function useState(v){return[v,function(){},function(){},v]};'
  + 'export function useEffect(f,d){return undefined};'
  + 'export function useRef(v){return{current:v}};'
  + 'export function useCallback(f,d){return f};'
  + 'export function useMemo(f,d){return f()};'
  + 'export function useContext(c){return undefined};'
  + 'export default {}'

// Shim react/jsx-runtime
const jsxShim = 'export function jsx(c,p){return{component:c,props:p,_t:"jsx"}}'
  + 'export function jsxs(c,p){return{component:c,props:p,_t:"jsxs"}}'
  + 'export function Fragment(p){return p&&p.children}'

const sdkUrl = 'data:text/javascript,' + encodeURIComponent(sdkShim)
const reactUrl = 'data:text/javascript,' + encodeURIComponent(reactShim)
const jsxUrl = 'data:text/javascript,' + encodeURIComponent(jsxShim)

const blobSrc = src
  .replace(/from\s+['"]@hermes\/plugin-sdk['"]/g, "from '" + sdkUrl + "'")
  .replace(/from\s+['"]react\/jsx-runtime['"]/g, "from '" + jsxUrl + "'")
  .replace(/from\s+['"]react['"]/g, "from '" + reactUrl + "'")

const blobUrl = 'data:text/javascript,' + encodeURIComponent(blobSrc)
const mod = await import(blobUrl)
const plugin = mod.default
const __test = mod.__test

// Simulate register()
const contribs = []
let restCalls = []
const mockCtx = {
  register(c) { contribs.push(c) },
  registerMany(arr) { for (const c of arr) contribs.push(c) },
  rest(path, opts) { restCalls.push(path); return Promise.resolve({}) }
}

try {
  plugin.register(mockCtx)
} catch(e) {
  // register may fail if __test not available
}

// Export results as JSON
const routeContrib = contribs.find(c => c.area === 'routes')
let renderResult = null
if (routeContrib && typeof routeContrib.render === 'function') {
  try {
    const rendered = routeContrib.render()
    renderResult = { returned: rendered != null, isJsx: rendered && (rendered._t === 'jsx' || rendered._t === 'jsxs') }
  } catch(e) {
    renderResult = { error: e.message }
  }
}
const results = {
  id: plugin && plugin.id,
  name: plugin && plugin.name,
  hasRegister: typeof (plugin && plugin.register) === 'function',
  contribCount: contribs.length,
  routeContrib: routeContrib,
  routeContribHasRender: routeContrib && typeof routeContrib.render === 'function',
  renderResult: renderResult,
  navContrib: contribs.find(c => c.area === 'sidebar.nav'),
  restCalls: restCalls,
  __testKeys: __test ? Object.keys(__test) : [],
  __testAvailable: !!__test,
}

// Test __test functions if available
if (__test) {
  try {
    results.pathBuilders = {}

    if (__test.sourcesPath) results.pathBuilders.sources = __test.sourcesPath()
    if (__test.changePath) {
      results.pathBuilders.change = __test.changePath('src-1', 'my-change')
      results.pathBuilders.changeSpecial = __test.changePath('src-1', 'feat/with spaces & special')
    }
    if (__test.ideaPath) {
      results.pathBuilders.idea = __test.ideaPath('src-1', 'my-idea')
      results.pathBuilders.ideaSpecial = __test.ideaPath('src-1', 'feat/with spaces & special')
    }
    if (__test.specBrowserPath) {
      results.pathBuilders.specBrowser = __test.specBrowserPath('src-1')
      results.pathBuilders.specBrowserDirty = __test.specBrowserPath('src-1', { dirty: true })
    }
    if (__test.specPath) {
      results.pathBuilders.spec = __test.specPath('src-1', 'specs/readme.md')
      results.pathBuilders.specSpecial = __test.specPath('src-1', 'specs/with spaces.md')
    }

    // Source selection
    results.sourceSelection = {}
    if (__test.selectFirstValid) {
      const sources = [
        { id: 'src-1', valid: false, error: 'bad' },
        { id: 'src-2', valid: true, name: 'good' },
        { id: 'src-3', valid: true, name: 'also-good' }
      ]
      results.sourceSelection.firstValid = __test.selectFirstValid(sources)
      const allInvalid = [
        { id: 'src-1', valid: false, error: 'bad' },
        { id: 'src-2', valid: false, error: 'worse' }
      ]
      results.sourceSelection.allInvalid = __test.selectFirstValid(allInvalid)
      results.sourceSelection.noSources = __test.selectFirstValid([])
    }

    // Board helpers
    results.board = {}
    if (__test.normalizeStatus) {
      results.board.normalizeInProgress = __test.normalizeStatus('in-progress')
      results.board.normalizeDraft = __test.normalizeStatus('draft')
      results.board.normalizeArchived = __test.normalizeStatus('archived')
      results.board.normalizeUnknown = __test.normalizeStatus('something-new')
    }
    if (__test.groupByStatus) {
      const items = [
        { name: 'a', status: 'draft', token: 'A', sequence: 2 },
        { name: 'b', status: 'in-progress', token: 'B', sequence: 1 },
        { name: 'c', status: 'done', token: 'C', sequence: 3 },
        { name: 'd', status: 'archived', token: 'D', sequence: 0 },
      ]
      const groups = __test.groupByStatus(items, false)
      results.board.groupKeys = Object.keys(groups)
      results.board.groupCounts = {}
      for (const k in groups) results.board.groupCounts[k] = groups[k].length
    }
    if (__test.sortItems) {
      const sortItems = [
        { name: 'b', sequence: 2, title: 'Alpha' },
        { name: 'a', sequence: 1, title: 'Beta' },
        { name: 'c', sequence: 1, title: 'Alpha' },
      ]
      results.board.sorted = __test.sortItems(sortItems).map(i => i.name)
    }
    if (__test.filterItems) {
      const filterItems = [
        { name: 'alpha-change', title: 'Alpha Feature', token: 'ALPHA' },
        { name: 'beta-fix', title: 'Beta Bugfix', token: 'BETA' },
        { name: 'gamma-refactor', title: 'Gamma Refactor', token: 'GAMMA' },
      ]
      results.board.filteredAlpha = __test.filterItems(filterItems, 'alpha').map(i => i.name)
      results.board.filteredBeta = __test.filterItems(filterItems, 'BETA').map(i => i.name)
      results.board.filteredEmpty = __test.filterItems(filterItems, 'delta').map(i => i.name)
      results.board.filteredClear = __test.filterItems(filterItems, '').map(i => i.name)
    }
    if (__test.toggleArchived) {
      results.board.withArchived = __test.toggleArchived(true)
      results.board.withoutArchived = __test.toggleArchived(false)
    }

    // Task parser
    results.tasks = {}
    if (__test.parseTasks) {
      const taskContent = '## Section 1\n- [x] Done task\n- [ ] Pending task\n- [x] Another done\n\n## Section 2\n- [ ] Open task\n'
      const parsed = __test.parseTasks(taskContent)
      results.tasks.total = parsed.total
      results.tasks.done = parsed.done
      results.tasks.sections = parsed.sections
    }

    // Markdown parser
    results.markdown = {}
    if (__test.renderMarkdown) {
      const md = '# Heading\n\nA paragraph with **bold** and `code`.\n\n- item 1\n- item 2'
      const rendered = __test.renderMarkdown(md)
      results.markdown.isArray = Array.isArray(rendered)
      results.markdown.length = rendered && rendered.length
    }

    // State classifier
    if (__test.classifyState) {
      results.markdown.stateLoading = __test.classifyState({ isLoading: true, error: null, data: null })
      results.markdown.stateError = __test.classifyState({ isLoading: false, error: new Error('fail'), data: null })
      results.markdown.stateEmpty = __test.classifyState({ isLoading: false, error: null, data: { items: [] } })
      results.markdown.stateContent = __test.classifyState({ isLoading: false, error: null, data: { items: [1] } })
    }

    // Diff helpers
    results.diff = {}
    if (__test.classifyDiffLine) {
      results.diff.added = __test.classifyDiffLine('+added line')
      results.diff.removed = __test.classifyDiffLine('-removed line')
      results.diff.hunk = __test.classifyDiffLine('@@ -1,3 +1,4 @@')
      results.diff.context = __test.classifyDiffLine(' unchanged line')
    }
    if (__test.hasDiffMode) {
      results.diff.hasSemantic = __test.hasDiffMode({ semantic_diff: { groups: [] } }, 'semantic')
      results.diff.hasSplit = __test.hasDiffMode({ before: 'a', after: 'b' }, 'split')
      results.diff.hasRaw = __test.hasDiffMode({ diff: '+line' }, 'raw')
      results.diff.noSemantic = __test.hasDiffMode({ before: 'a', after: 'b' }, 'semantic')
    }

    // URL safety
    results.urlSafety = {}
    if (__test.isSafeUrl) {
      results.urlSafety.httpsAllowed = __test.isSafeUrl('https://example.com')
      results.urlSafety.httpAllowed = __test.isSafeUrl('http://example.com')
      results.urlSafety.relativeAllowed = __test.isSafeUrl('/path/to/page')
      results.urlSafety.javascriptBlocked = !__test.isSafeUrl('javascript:alert(1)')
      results.urlSafety.dataBlocked = !__test.isSafeUrl('data:text/html,<script>')
      results.urlSafety.fileBlocked = !__test.isSafeUrl('file:///etc/passwd')
      results.urlSafety.emptyBlocked = !__test.isSafeUrl('')
      results.urlSafety.nullBlocked = !__test.isSafeUrl(null)
    }

    // __test is frozen
    results.testFrozen = Object.isFrozen(__test)

    // renderInline returns JSX (not plain objects)
    results.inlineJsx = {}
    if (__test.renderMarkdown) {
      // renderMarkdown returns parsed blocks; inline processing is in MarkdownElement.
      // Test the paragraph structure is correct.
      var inlineResult = __test.renderMarkdown('Text with **bold** and `code` and [link](https://example.com)')
      results.inlineJsx.isArray = Array.isArray(inlineResult)
      results.inlineJsx.hasParagraph = inlineResult.some(function(el) { return el && el.type === 'paragraph' })
      // Verify renderInline is used inside MarkdownElement (structural check via source)
      // The actual JSX rendering happens at React render time; here we verify the
      // parsed structure contains the text that renderInline will process.
      var para = inlineResult.find(function(el) { return el && el.type === 'paragraph' })
      results.inlineJsx.textHasInlineMarkup = para && para.text && para.text.includes('**bold**') && para.text.includes('`code`')
    }

  } catch (e) {
    results.__testError = e.message
  }
}

process.stdout.write(JSON.stringify(results))
