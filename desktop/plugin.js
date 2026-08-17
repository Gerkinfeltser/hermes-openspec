/**
 * OpenSpec Desktop runtime plugin — read-only project surface.
 *
 * Registers /openspec route + sidebar nav entry. Provides source selector,
 * work board (ideas, changes by status), change/idea detail dialogs,
 * current specs browser, and worktree diff views. All data via ctx.rest.
 *
 * Packaging: single uncompiled ESM file. Runtime loader scans
 * ~/.hermes/plugins/openspec/desktop/plugin.js.
 */

import {
  Badge, Button, cn, CopyButton, Dialog, DialogContent, EmptyState, ErrorState,
  Input, Loader, ROUTES_AREA, ScrollArea, SearchField, Select,
  SelectContent, SelectItem, SelectTrigger, SelectValue,
  SegmentedControl, SIDEBAR_NAV_AREA, Tabs, TabsList, TabsTrigger, useQuery
} from '@hermes/plugin-sdk'
import React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

// ═══════════════════════════════════════════════════════════════════════════════
// Pure helpers — exported as __test for headless verification
// ═══════════════════════════════════════════════════════════════════════════════

function sourcesPath() { return '/sources' }

function changePath(sourceId, name) {
  return '/sources/' + encodeURIComponent(sourceId) + '/changes/' + encodeURIComponent(name)
}

function ideaPath(sourceId, name) {
  return '/sources/' + encodeURIComponent(sourceId) + '/ideas/' + encodeURIComponent(name)
}

function specBrowserPath(sourceId, opts) {
  var base = '/sources/' + encodeURIComponent(sourceId) + '/spec-browser'
  if (opts && opts.dirty) return base + '?dirty=true'
  return base
}

function specPath(sourceId, path) {
  return '/sources/' + encodeURIComponent(sourceId) + '/specs?path=' + encodeURIComponent(path)
}

function selectFirstValid(sources) {
  if (!sources || sources.length === 0) return null
  var valid = sources.filter(function(s) { return s.valid !== false })
  if (valid.length > 0) return valid[0]
  return sources[0]
}

function normalizeStatus(status) {
  var s = String(status || '').toLowerCase()
  if (s === 'in-progress' || s === 'inprogress' || s === 'in_progress') return 'in-progress'
  if (s === 'draft') return 'draft'
  if (s === 'todo') return 'todo'
  if (s === 'done') return 'done'
  if (s === 'archived') return 'archived'
  return 'todo'
}

var STATUS_ORDER = ['ideas', 'draft', 'todo', 'in-progress', 'done', 'archived']

function groupByStatus(items, showArchived) {
  var groups = {}
  var order = showArchived ? STATUS_ORDER : STATUS_ORDER.filter(function(s) { return s !== 'archived' })
  for (var i = 0; i < order.length; i++) groups[order[i]] = []
  for (var j = 0; j < (items || []).length; j++) {
    var item = items[j]
    var status = normalizeStatus(item.status || item.state || item.phase)
    if (!showArchived && status === 'archived') continue
    if (!groups[status]) groups[status] = []
    groups[status].push(item)
  }
  return groups
}

function sortItems(items) {
  return (items || []).slice().sort(function(a, b) {
    var sa = a.sequence != null ? a.sequence : 9999
    var sb = b.sequence != null ? b.sequence : 9999
    if (sa !== sb) return sa - sb
    var ta = (a.title || a.name || '').toLowerCase()
    var tb = (b.title || b.name || '').toLowerCase()
    if (ta < tb) return -1
    if (ta > tb) return 1
    return 0
  })
}

function filterItems(items, query) {
  if (!query) return items || []
  var q = String(query).toLowerCase()
  return (items || []).filter(function(item) {
    var title = String(item.title || item.name || '').toLowerCase()
    var token = String(item.token || '').toLowerCase()
    var name = String(item.name || '').toLowerCase()
    return title.includes(q) || token.includes(q) || name.includes(q)
  })
}

function toggleArchived(current) { return !current }

function parseTasks(content) {
  var total = 0, done = 0
  var sections = []
  var lines = (content || '').split('\n')
  var currentSection = null
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    var headingMatch = line.match(/^#{1,6}\s+(.+)/)
    if (headingMatch) {
      currentSection = { title: headingMatch[1], done: 0, total: 0, tasks: [] }
      sections.push(currentSection)
    }
    var taskMatch = line.match(/^[-*]\s+\[([ xX])\]\s*(.*)/)
    if (taskMatch) {
      var isDone = taskMatch[1] === 'x' || taskMatch[1] === 'X'
      total++
      if (isDone) done++
      var task = { text: taskMatch[2], done: isDone }
      if (currentSection) { currentSection.total++; if (isDone) currentSection.done++; currentSection.tasks.push(task) }
    }
  }
  return { total: total, done: done, sections: sections }
}

function renderMarkdown(content) {
  if (!content) return []
  var elements = []
  var lines = content.split('\n')
  var i = 0
  while (i < lines.length) {
    var line = lines[i]

    // Fenced code block
    if (line.match(/^```/)) {
      var lang = line.slice(3).trim()
      var codeLines = []
      i++
      while (i < lines.length && !lines[i].match(/^```/)) { codeLines.push(lines[i]); i++ }
      i++ // skip closing fence
      elements.push({ type: 'fenced', lang: lang, content: codeLines.join('\n') })
      continue
    }

    // Heading
    var headingMatch = line.match(/^(#{1,6})\s+(.*)/)
    if (headingMatch) {
      elements.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] })
      i++; continue
    }

    // Unordered list
    if (line.match(/^[-*]\s+/)) {
      elements.push({ type: 'list-item', ordered: false, text: line.replace(/^[-*]\s+/, '') })
      i++; continue
    }

    // Ordered list
    if (line.match(/^\d+\.\s+/)) {
      elements.push({ type: 'list-item', ordered: true, text: line.replace(/^\d+\.\s+/, '') })
      i++; continue
    }

    // Empty line
    if (line.trim() === '') { i++; continue }

    // Paragraph
    elements.push({ type: 'paragraph', text: line })
    i++
  }
  return elements
}

function classifyState(query) {
  if (query.isLoading) return 'loading'
  if (query.error) return 'error'
  if (query.data) {
    if (Array.isArray(query.data) && query.data.length === 0) return 'empty'
    if (query.data.sources && query.data.sources.length === 0) return 'empty'
    if (query.data.files && query.data.files.length === 0) return 'empty'
    if (query.data.items && Array.isArray(query.data.items) && query.data.items.length === 0) return 'empty'
    return 'content'
  }
  return 'empty'
}

function classifyDiffLine(line) {
  if (!line) return 'context'
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'removed'
  if (line.startsWith('@@')) return 'hunk'
  return 'context'
}

function hasDiffMode(data, mode) {
  if (!data) return false
  if (mode === 'semantic') return !!(data.semantic_diff && (data.semantic_diff.groups || data.semantic_diff.requirements))
  if (mode === 'split') return !!(data.before != null && data.after != null)
  if (mode === 'raw') return !!(data.diff || data.raw_diff)
  return false
}

function effectiveDiffMode(desired, data) {
  if (hasDiffMode(data, desired)) return desired
  var fallback = ['semantic', 'split', 'raw']
  for (var i = 0; i < fallback.length; i++) {
    if (hasDiffMode(data, fallback[i])) return fallback[i]
  }
  return desired
}

// ═══════════════════════════════════════════════════════════════════════════════
// API adapter — read-only, namespace-scoped
// ═══════════════════════════════════════════════════════════════════════════════

function createApi(ctx) {
  return {
    sources: function() { return ctx.rest(sourcesPath()) },
    change: function(sourceId, name) { return ctx.rest(changePath(sourceId, name)) },
    idea: function(sourceId, name) { return ctx.rest(ideaPath(sourceId, name)) },
    specBrowser: function(sourceId, opts) { return ctx.rest(specBrowserPath(sourceId, opts)) },
    spec: function(sourceId, path) { return ctx.rest(specPath(sourceId, path)) },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Markdown renderer — safe subset, no innerHTML
// ═══════════════════════════════════════════════════════════════════════════════

function isSafeUrl(url) {
  if (!url) return false
  // Strip leading whitespace and control characters (U+0000-U+001F, U+007F-U+009F)
  var s = String(url).replace(/^[\s\x00-\x1f\x7f-\x9f]+/, '')
  if (!s) return false
  // Allow relative paths and fragment-only links
  if (s.startsWith('/') || s.startsWith('#') || s.startsWith('?')) return true
  // Explicit scheme allowlist: http, https, mailto (case-insensitive)
  var lower = s.toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) return true
  // Everything else is rejected (javascript:, data:, file:, vbscript:, etc.)
  return false
}

function renderInline(text) {
  if (!text) return text
  var parts = []
  var remaining = text
  var regex = /(\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  var lastIndex = 0
  var match
  while ((match = regex.exec(remaining)) !== null) {
    if (match.index > lastIndex) parts.push(remaining.slice(lastIndex, match.index))
    if (match[2]) parts.push(jsx('strong', { style: { fontWeight: 600 }, children: match[2] }))
    else if (match[3]) parts.push(jsx('code', { style: { background: 'var(--editor-background, #1e1e1e)', padding: '1px 4px', borderRadius: '3px', fontFamily: 'monospace', fontSize: '0.9em' }, children: match[3] }))
    else if (match[4]) {
      if (isSafeUrl(match[5])) {
        parts.push(jsx('a', { href: match[5], target: '_blank', rel: 'noopener noreferrer', style: { color: 'var(--link-foreground, #4fc3f7)', textDecoration: 'underline' }, children: match[4] }))
      } else {
        parts.push(jsx('span', { style: { color: 'var(--muted-foreground, #888)' }, children: match[4] + ' [unsafe link]' }))
      }
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < remaining.length) parts.push(remaining.slice(lastIndex))
  return parts
}

function MarkdownElement(el) {
  if (typeof el === 'string') return el
  if (typeof el === 'number') return el
  if (!el || !el.type) return null
  switch (el.type) {
    case 'heading':
      return jsx('div', { style: { fontWeight: 'bold', fontSize: el.level <= 2 ? '1.1em' : '1em', margin: '8px 0 4px', color: 'var(--foreground, #e0e0e0)' }, children: renderInline(el.text) })
    case 'paragraph':
      return jsx('div', { style: { margin: '4px 0', color: 'var(--foreground, #e0e0e0)' }, children: renderInline(el.text) })
    case 'list-item':
      return jsxs('div', { style: { margin: '1px 0', paddingLeft: '16px', color: 'var(--foreground, #e0e0e0)' }, children: [
        el.ordered ? '  ' : '\u2022 ',
        renderInline(el.text)
      ] })
    case 'fenced':
      return jsx('pre', { style: { background: 'var(--editor-background, #1e1e1e)', padding: '8px', borderRadius: '4px', margin: '4px 0', overflow: 'auto', fontFamily: 'monospace', fontSize: '0.9em', color: 'var(--foreground, #e0e0e0)' }, children: el.content })
    default:
      return null
  }
}

function MarkdownView({ content }) {
  var elements = renderMarkdown(content)
  if (!elements || elements.length === 0) return jsx(EmptyState, { title: 'No content', description: 'This document is empty.' })
  return jsxs('div', { style: { padding: '12px' }, children: elements.map(function(el, i) { return jsx(MarkdownElement, { key: i }, i) }) })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Query state wrapper
// ═══════════════════════════════════════════════════════════════════════════════

function QueryState({ query, onRetry, emptyTitle, emptyDescription, children }) {
  var state = classifyState(query)
  if (state === 'loading') return jsx(Loader, { type: 'lemniscate-bloom' })
  if (state === 'error') return jsx(ErrorState, {
    title: 'Request failed',
    description: (query.error && query.error.message) || 'Could not reach the backend.',
    onRetry: onRetry
  })
  if (state === 'empty') return jsx(EmptyState, { title: emptyTitle || 'Nothing found', description: emptyDescription || 'No data available.' })
  return children
}

// ═══════════════════════════════════════════════════════════════════════════════
// Card helpers
// ═══════════════════════════════════════════════════════════════════════════════

function CardTaskFraction({ item }) {
  var tasks = item.tasks || item.taskStats
  if (!tasks) return null
  var done = tasks.done != null ? tasks.done : (tasks.completed || 0)
  var total = tasks.total != null ? tasks.total : (tasks.count || 0)
  if (total === 0) return null
  return jsx(Badge, { variant: 'outline', children: done + '/' + total + ' tasks' })
}

function CardArtifacts({ item }) {
  var badges = []
  if (item.hasProposal) badges.push({ label: 'proposal', color: '#60a5fa' })
  if (item.hasTasks) badges.push({ label: 'tasks', color: '#34d399' })
  if (item.hasDesign) badges.push({ label: 'design', color: '#a78bfa' })
  if (item.hasSpecs) badges.push({ label: 'specs', color: '#fbbf24' })
  if (badges.length === 0) return null
  return jsxs('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' },
    children: badges.map(function(b, i) {
      return jsx(Badge, { variant: 'secondary', style: { fontSize: '10px', color: b.color }, children: b.label }, i)
    })
  })
}

function BoardCard({ item, sourceId, sourceToken, onSelect }) {
  var token = item.token || item.name || ''
  var title = item.title || item.name || 'Untitled'
  var displayToken = sourceToken ? sourceToken + '/' + token : token
  var onClick = function() { onSelect(item) }
  return jsxs('div', {
    className: cn(
      'rounded-md border border-(--ui-border) p-3 cursor-pointer',
      'hover:border-(--ui-focus-border) transition-colors',
      'flex flex-col gap-1'
    ),
    onClick: onClick,
    children: [
      jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }, children: [
        jsx('div', { style: { fontWeight: 500, fontSize: '13px', color: 'var(--foreground, #e0e0e0)' }, children: title }),
        item.sequence != null ? jsx(Badge, { variant: 'outline', style: { fontSize: '10px', flexShrink: 0 }, children: '#' + item.sequence }) : null
      ] }),
      jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }, children: [
        jsx(CopyButton, { value: displayToken, children: jsx('span', { style: { fontSize: '11px', color: 'var(--muted-foreground, #888)', fontFamily: 'monospace' }, children: displayToken }) }),
        jsx(CardTaskFraction, { item: item }),
      ] }),
      jsx(CardArtifacts, { item: item }),
    ]
  }, token || title)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Board columns
// ═══════════════════════════════════════════════════════════════════════════════

var COLUMN_LABELS = {
  'ideas': 'Ideas',
  'draft': 'Draft',
  'todo': 'Todo',
  'in-progress': 'In Progress',
  'done': 'Done',
  'archived': 'Archived',
}

function BoardColumn({ status, items, sourceId, onSelect }) {
  var label = COLUMN_LABELS[status] || status
  var sorted = sortItems(items)
  return jsxs('div', { style: { minWidth: '220px', maxWidth: '280px', flexShrink: 0 }, children: [
    jsxs('div', { style: { fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', color: 'var(--muted-foreground, #888)', padding: '0 4px 8px', letterSpacing: '0.05em' }, children: [
      label,
      items.length > 0 ? ' (' + items.length + ')' : '',
    ] }),
    jsxs('div', { className: cn('flex flex-col gap-2'), children: sorted.map(function(item) {
      return jsx(BoardCard, {
        item: item,
        sourceId: sourceId,
        onSelect: onSelect,
      }, item.token || item.name || item.title)
    }) }),
    items.length === 0 ? jsx('div', { style: { color: 'var(--muted-foreground, #666)', fontSize: '12px', padding: '12px 4px', fontStyle: 'italic' }, children: 'No items' }) : null,
  ] })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Change detail dialog
// ═══════════════════════════════════════════════════════════════════════════════

function ChangeDetailDialog({ api, sourceId, change, onClose }) {
  var query = useQuery({
    queryKey: ['openspec', 'change', sourceId, change.name || change.token],
    queryFn: function() { return api.change(sourceId, change.name || change.token) }
  })

  var [activeTab, setActiveTab] = React.useState(null)

  if (query.isLoading) return jsx(Dialog, { open: true, onOpenChange: onClose, children: jsx(DialogContent, { children: jsx(Loader, { type: 'lemniscate-bloom' }) }) })
  if (query.error) return jsx(Dialog, { open: true, onOpenChange: onClose, children: jsx(DialogContent, { children: jsx(ErrorState, { title: 'Failed to load change', description: query.error.message, onRetry: function() { query.refetch() } }) }) })

  var data = query.data || {}
  var tabs = []
  if (data.proposal) tabs.push({ key: 'proposal', label: 'Proposal', content: jsx(MarkdownView, { content: data.proposal }) })
  if (data.tasks) tabs.push({ key: 'tasks', label: 'Tasks', content: jsx(TaskView, { content: data.tasks }) })
  if (data.design) tabs.push({ key: 'design', label: 'Design', content: jsx(MarkdownView, { content: data.design }) })
  if (data.specs && data.specs.length > 0) tabs.push({ key: 'specs', label: 'Specs', content: jsx(SpecsDetailView, { specs: data.specs }) })

  var currentTab = activeTab || (tabs.length > 0 ? tabs[0].key : null)

  var title = change.title || change.name || 'Change Detail'
  var token = change.token || change.name || ''

  return jsxs(Dialog, { open: true, onOpenChange: onClose, children: [
    jsxs(DialogContent, { style: { padding: '16px', maxWidth: '800px', maxHeight: '70vh', overflow: 'auto' }, children: [
      jsxs('div', { style: { marginBottom: '12px' }, children: [
        jsx('h2', { style: { fontSize: '18px', fontWeight: 600, margin: '0 0 4px', color: 'var(--foreground, #e0e0e0)' }, children: title }),
        jsxs('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' }, children: [
          jsx(CopyButton, { value: token, children: jsx('span', { style: { fontSize: '12px', color: 'var(--muted-foreground, #888)', fontFamily: 'monospace' }, children: token }) }),
          data.taskStats ? jsx(Badge, { variant: 'outline', children: data.taskStats.done + '/' + data.taskStats.total + ' tasks' }) : null,
        ] }),
      ] }),
      tabs.length > 0 ? jsxs(Tabs, { value: currentTab, onValueChange: setActiveTab, children: [
        jsx(TabsList, { children: tabs.map(function(t) { return jsx(TabsTrigger, { value: t.key, children: t.label }, t.key) }) }),
        tabs.map(function(t) { return currentTab === t.key ? jsx('div', { key: t.key }, t.content) : null }),
      ] }) : jsx(EmptyState, { title: 'No artifacts', description: 'This change has no proposal, tasks, design, or spec content.' }),
    ] }),
  ] })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Task view
// ═══════════════════════════════════════════════════════════════════════════════

function TaskView({ content }) {
  var parsed = parseTasks(content)
  return jsxs('div', { style: { padding: '12px' }, children: [
    jsxs('div', { style: { marginBottom: '12px', color: 'var(--muted-foreground, #888)', fontSize: '13px' }, children: [
      parsed.done + ' of ' + parsed.total + ' tasks completed',
    ] }),
    parsed.sections.map(function(section, i) {
      return jsxs('div', { style: { marginBottom: '12px' }, children: [
        jsx('div', { style: { fontWeight: 600, fontSize: '14px', marginBottom: '4px', color: 'var(--foreground, #e0e0e0)' }, children: section.title }),
        section.tasks.map(function(task, j) {
          return jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0', color: 'var(--foreground, #e0e0e0)' }, children: [
            jsx('span', { style: { color: task.done ? 'var(--primary, #4caf50)' : 'var(--muted-foreground, #888)' }, children: task.done ? '\u2611' : '\u2610' }),
            jsx('span', { style: { fontSize: '13px', textDecoration: task.done ? 'line-through' : 'none', opacity: task.done ? 0.6 : 1 }, children: task.text }),
          ] }, j)
        }),
      ] }, i)
    }),
    parsed.sections.length === 0 ? jsx(MarkdownView, { content: content }) : null,
  ] })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Idea detail dialog
// ═══════════════════════════════════════════════════════════════════════════════

function IdeaDetailDialog({ api, sourceId, idea, onClose }) {
  var query = useQuery({
    queryKey: ['openspec', 'idea', sourceId, idea.name || idea.token],
    queryFn: function() { return api.idea(sourceId, idea.name || idea.token) }
  })

  if (query.isLoading) return jsx(Dialog, { open: true, onOpenChange: onClose, children: jsx(DialogContent, { children: jsx(Loader, { type: 'lemniscate-bloom' }) }) })
  if (query.error) return jsx(Dialog, { open: true, onOpenChange: onClose, children: jsx(DialogContent, { children: jsx(ErrorState, { title: 'Failed to load idea', description: query.error.message, onRetry: function() { query.refetch() } }) }) })

  var data = query.data || {}
  var title = idea.title || idea.name || 'Idea Detail'

  return jsxs(Dialog, { open: true, onOpenChange: onClose, children: [
    jsxs(DialogContent, { style: { padding: '16px', maxWidth: '800px', maxHeight: '70vh', overflow: 'auto' }, children: [
      jsx('h2', { style: { fontSize: '18px', fontWeight: 600, margin: '0 0 12px', color: 'var(--foreground, #e0e0e0)' }, children: title }),
      jsx(MarkdownView, { content: data.content }),
    ] }),
  ] })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Change spec detail — Proposed and Diff views
// ═══════════════════════════════════════════════════════════════════════════════

function SpecsDetailView({ specs }) {
  var [selectedIdx, setSelectedIdx] = React.useState(0)
  var [diffMode, setDiffMode] = React.useState('semantic')

  if (!specs || specs.length === 0) return jsx(EmptyState, { title: 'No specs', description: 'No spec changes in this change.' })
  var spec = specs[selectedIdx] || specs[0]
  var effMode = effectiveDiffMode(diffMode, spec)

  return jsxs('div', { style: { padding: '12px' }, children: [
    specs.length > 1 ? jsxs('div', { style: { marginBottom: '8px' }, children: [
      jsx('select', {
        value: selectedIdx,
        onChange: function(e) { setSelectedIdx(parseInt(e.target.value, 10)) },
        style: { padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--ui-border, #333)', background: 'var(--input-background, #2a2a2a)', color: 'var(--foreground, #e0e0e0)' },
        children: specs.map(function(s, i) { return jsx('option', { value: i, children: s.path || s.title || ('Spec ' + (i + 1)) }, i) })
      })
    ] }) : null,
    spec.path ? jsx('div', { style: { fontSize: '12px', color: 'var(--muted-foreground, #888)', marginBottom: '8px', fontFamily: 'monospace' }, children: spec.path }) : null,
    spec.status ? jsx(Badge, { variant: 'outline', style: { marginBottom: '8px' }, children: spec.status }) : null,
    hasDiffMode(spec, 'semantic') || hasDiffMode(spec, 'split') || hasDiffMode(spec, 'raw') ? jsxs('div', { style: { display: 'flex', gap: '4px', marginBottom: '8px' }, children: [
      hasDiffMode(spec, 'semantic') ? jsx(Button, { variant: effMode === 'semantic' ? 'default' : 'outline', size: 'sm', onClick: function() { setDiffMode('semantic') }, children: 'Semantic' }) : null,
      hasDiffMode(spec, 'split') ? jsx(Button, { variant: effMode === 'split' ? 'default' : 'outline', size: 'sm', onClick: function() { setDiffMode('split') }, children: 'Side-by-side' }) : null,
      hasDiffMode(spec, 'raw') ? jsx(Button, { variant: effMode === 'raw' ? 'default' : 'outline', size: 'sm', onClick: function() { setDiffMode('raw') }, children: 'Raw' }) : null,
    ] }) : null,
    effMode === 'semantic' && hasDiffMode(spec, 'semantic') ? jsx(SemanticDiffView, { data: spec.semantic_diff }) : null,
    effMode === 'split' && hasDiffMode(spec, 'split') ? jsx(SplitDiffView, { before: spec.before, after: spec.after }) : null,
    effMode === 'raw' && hasDiffMode(spec, 'raw') ? jsx(RawDiffView, { diff: spec.diff || spec.raw_diff }) : null,
    spec.content ? jsx(MarkdownView, { content: spec.content }) : null,
  ] })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Diff views
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeSemanticGroups(data) {
  if (!data) return []
  // Legacy flat groups array (data.groups)
  if (data.groups && Array.isArray(data.groups)) return data.groups
  // Backend contract: {status, requirements: {added, modified, removed, unchanged}}
  var reqs = data.requirements
  if (!reqs || typeof reqs !== 'object' || Array.isArray(reqs)) return []
  var items = []
  var added = reqs.added || []
  var modified = reqs.modified || []
  var removed = reqs.removed || []
  for (var i = 0; i < added.length; i++) {
    var a = added[i]
    items.push({ label: 'Added', name: a.name || '', description: a.description || '', color: 'var(--primary, #4caf50)' })
  }
  for (var j = 0; j < modified.length; j++) {
    var m = modified[j]
    var beforeDesc = m.before && typeof m.before === 'object' ? (m.before.description || '') : String(m.before || '')
    var afterDesc = m.after && typeof m.after === 'object' ? (m.after.description || '') : String(m.after || '')
    items.push({ label: 'Modified', name: m.name || '', description: '', before: beforeDesc, after: afterDesc, color: 'var(--warning, #ff9800)' })
  }
  for (var k = 0; k < removed.length; k++) {
    var r = removed[k]
    items.push({ label: 'Removed', name: r.name || '', description: r.description || '', color: 'var(--destructive, #f44336)' })
  }
  return items
}

function SemanticDiffView({ data }) {
  if (!data) return null
  var items = normalizeSemanticGroups(data)
  return jsxs('div', { style: { padding: '8px' }, children: [
    jsx('div', { style: { fontWeight: 600, marginBottom: '8px', color: 'var(--foreground, #e0e0e0)' }, children: 'Semantic Changes' }),
    items.map(function(item, i) {
      return jsxs('div', { style: { marginBottom: '8px', padding: '8px', background: 'var(--card-background, #1a1a1a)', borderRadius: '4px', border: '1px solid var(--ui-border, #333)' }, children: [
        jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }, children: [
          jsx('span', { style: { fontSize: '10px', fontWeight: 600, padding: '1px 5px', borderRadius: '3px', background: item.color, color: '#fff' }, children: item.label }),
          item.name ? jsx('span', { style: { fontWeight: 500, color: 'var(--foreground, #e0e0e0)' }, children: item.name }) : null,
        ] }),
        item.description ? jsx('div', { style: { fontSize: '12px', color: 'var(--muted-foreground, #888)', marginBottom: '2px' }, children: item.description }) : null,
        item.before != null && item.before !== '' ? jsx('div', { style: { color: 'var(--destructive, #f44336)', fontSize: '12px', marginBottom: '2px' }, children: '- ' + item.before }) : null,
        item.after != null && item.after !== '' ? jsx('div', { style: { color: 'var(--primary, #4caf50)', fontSize: '12px' }, children: '+ ' + item.after }) : null,
      ] }, i)
    }),
  ] })
}

function SplitDiffView({ before, after }) {
  return jsxs('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '8px' }, children: [
    jsxs('div', { children: [
      jsx('div', { style: { fontWeight: 500, marginBottom: '4px', color: 'var(--muted-foreground, #888)', fontSize: '12px' }, children: 'Before' }),
      jsx('pre', { style: { fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', padding: '8px', background: 'var(--editor-background, #1e1e1e)', borderRadius: '4px', color: 'var(--foreground, #e0e0e0)', margin: 0 }, children: before || '' }),
    ] }),
    jsxs('div', { children: [
      jsx('div', { style: { fontWeight: 500, marginBottom: '4px', color: 'var(--muted-foreground, #888)', fontSize: '12px' }, children: 'After' }),
      jsx('pre', { style: { fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', padding: '8px', background: 'var(--editor-background, #1e1e1e)', borderRadius: '4px', color: 'var(--foreground, #e0e0e0)', margin: 0 }, children: after || '' }),
    ] }),
  ] })
}

function RawDiffView({ diff }) {
  if (!diff) return null
  var lines = Array.isArray(diff) ? diff : String(diff).split('\n')
  return jsxs('pre', { style: { fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', padding: '8px', background: 'var(--editor-background, #1e1e1e)', borderRadius: '4px', margin: 0 }, children: lines.map(function(line, i) {
    var cls = classifyDiffLine(line)
    var style = { display: 'block', padding: '1px 4px' }
    if (cls === 'added') style.color = 'var(--primary, #4caf50)'
    else if (cls === 'removed') style.color = 'var(--destructive, #f44336)'
    else if (cls === 'hunk') style.color = 'var(--muted-foreground, #888)'
    else style.color = 'var(--foreground, #e0e0e0)'
    return jsx('span', { style: style, children: line + '\n' }, i)
  }) })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Work view
// ═══════════════════════════════════════════════════════════════════════════════

function WorkView({ api, source, sourceToken, onSelectItem }) {
  var ideas = (source.openspec && source.openspec.ideas) || []
  var changes = (source.openspec && source.openspec.changes) || []
  var allItems = ideas.map(function(idea) {
    return Object.assign({}, idea, { _type: 'idea' })
  }).concat(changes.map(function(change) {
    return Object.assign({}, change, { _type: 'change' })
  }))

  var [filter, setFilter] = React.useState('')
  var [showArchived, setShowArchived] = React.useState(true)

  var filtered = filterItems(allItems, filter)
  var grouped = groupByStatus(filtered, showArchived)

  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }, children: [
    jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px' }, children: [
      jsx(Input, { placeholder: 'Filter by title, token, or name...', value: filter, onChange: function(e) { setFilter(e.target.value) }, style: { flex: 1 } }),
      jsxs('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--muted-foreground, #888)', cursor: 'pointer', whiteSpace: 'nowrap' }, children: [
        jsx('input', { type: 'checkbox', checked: showArchived, onChange: function(e) { setShowArchived(e.target.checked) } }),
        'Archived',
      ] }),
    ] }),
    jsx(ScrollArea, { style: { flex: 1 }, children: jsxs('div', { style: { display: 'flex', gap: '12px', paddingBottom: '8px' }, children: STATUS_ORDER.map(function(status) {
      var items = grouped[status] || []
      if (!showArchived && status === 'archived') return null
      return jsx(BoardColumn, {
        status: status,
        items: items,
        sourceId: source.id,
        onSelect: onSelectItem,
      }, status)
    }) }) }),
  ] })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Specs view
// ═══════════════════════════════════════════════════════════════════════════════

function SpecsView({ api, sourceId }) {
  var [worktree, setWorktree] = React.useState(false)

  var query = useQuery({
    queryKey: ['openspec', 'spec-browser', sourceId, worktree],
    queryFn: function() { return api.specBrowser(sourceId, { dirty: worktree }) },
  })

  var [selectedFile, setSelectedFile] = React.useState(null)
  var [selectedSourceId, setSelectedSourceId] = React.useState(null)

  // Reset selected file when source changes to avoid stale old-source requests
  React.useEffect(function() {
    setSelectedFile(null)
    setSelectedSourceId(null)
  }, [sourceId])

  // Gate spec query on source match — never query old source with stale path
  var specQuery = useQuery({
    queryKey: ['openspec', 'spec', sourceId, selectedFile],
    queryFn: function() { return api.spec(sourceId, selectedFile) },
    enabled: !!selectedFile && selectedSourceId === sourceId && !worktree,
  })

  var files = (query.data && query.data.files) || []
  var branch = query.data && query.data.branch
  var changedCount = (query.data && query.data.changedCount) || files.length

  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }, children: [
    jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px' }, children: [
      jsx(Button, { variant: worktree ? 'default' : 'outline', size: 'sm', onClick: function() { setWorktree(false); setSelectedFile(null) }, children: 'Current' }),
      jsx(Button, { variant: worktree ? 'outline' : 'default', size: 'sm', onClick: function() { setWorktree(true); setSelectedFile(null) }, children: 'Worktree' }),
      branch ? jsx('span', { style: { fontSize: '12px', color: 'var(--muted-foreground, #888)' }, children: branch }) : null,
      worktree ? jsx(Badge, { variant: 'outline', children: changedCount + ' changed' }) : null,
    ] }),
    query.isLoading ? jsx(Loader, { type: 'lemniscate-bloom' }) : null,
    query.error ? jsx(ErrorState, { title: 'Failed to load specs', description: query.error.message, onRetry: function() { query.refetch() } }) : null,
    !query.isLoading && !query.error && files.length === 0 ? jsx(EmptyState, {
      title: worktree ? 'No spec changes between HEAD and worktree' : 'No specs found',
      description: worktree ? 'The working tree matches HEAD for all spec files.' : 'No spec files are registered for this source.',
    }) : null,
    !query.isLoading && files.length > 0 ? jsxs('div', { style: { display: 'flex', gap: '12px', flex: 1, overflow: 'hidden' }, children: [
      jsxs('div', { style: { width: '240px', flexShrink: 0, overflow: 'auto' }, children: [
        files.map(function(file) {
          var path = file.path || file.name || file
          var isSelected = selectedFile === path
          return jsxs('div', {
            className: cn(
              'px-3 py-2 cursor-pointer text-sm rounded-md',
              isSelected ? 'bg-(--ui-selected-background, #2a2a2a) text-foreground' : 'text-muted-foreground hover:bg-(--ui-hover-background, #1a1a1a)'
            ),
            onClick: function() { setSelectedFile(path); setSelectedSourceId(sourceId) },
            children: [
              jsx('div', { style: { fontFamily: 'monospace', fontSize: '12px' }, children: path }),
              file.status ? jsx(Badge, { variant: 'outline', style: { fontSize: '10px', marginTop: '2px' }, children: file.status }) : null,
            ]
          }, path)
        }),
      ] }),
      jsxs('div', { style: { flex: 1, overflow: 'auto' }, children: [
        worktree && selectedFile ? jsx(WorktreeDetailView, { sourceId: sourceId, file: selectedFile, files: files }) : null,
        !worktree && selectedFile && specQuery.isLoading ? jsx(Loader, { type: 'lemniscate-bloom' }) : null,
        !worktree && selectedFile && specQuery.error ? jsx(ErrorState, { title: 'Failed to load spec', description: specQuery.error.message, onRetry: function() { specQuery.refetch() } }) : null,
        !worktree && selectedFile && !specQuery.isLoading && !specQuery.error ? jsx(MarkdownView, { content: specQuery.data && specQuery.data.content }) : null,
        !selectedFile ? jsx(EmptyState, { title: 'Select a file', description: 'Choose a spec file from the list to view its content.' }) : null,
      ] }),
    ] }) : null,
  ] })
}

function WorktreeDetailView({ sourceId, file, files }) {
  var fileInfo = files.find(function(f) { return (f.path || f.name || f) === file }) || {}
  var [diffMode, setDiffMode] = React.useState('semantic')

  var data = fileInfo
  var effMode = effectiveDiffMode(diffMode, data)

  return jsxs('div', { style: { padding: '12px' }, children: [
    jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }, children: [
      jsx('h3', { style: { fontSize: '14px', fontWeight: 500, margin: 0, color: 'var(--foreground, #e0e0e0)' }, children: file }),
      fileInfo.status ? jsx(Badge, { variant: 'outline', children: fileInfo.status }) : null,
    ] }),
    hasDiffMode(data, 'semantic') || hasDiffMode(data, 'split') || hasDiffMode(data, 'raw') ? jsxs('div', { style: { display: 'flex', gap: '4px', marginBottom: '12px' }, children: [
      hasDiffMode(data, 'semantic') ? jsx(Button, { variant: effMode === 'semantic' ? 'default' : 'outline', size: 'sm', onClick: function() { setDiffMode('semantic') }, children: 'Semantic' }) : null,
      hasDiffMode(data, 'split') ? jsx(Button, { variant: effMode === 'split' ? 'default' : 'outline', size: 'sm', onClick: function() { setDiffMode('split') }, children: 'Side-by-side' }) : null,
      hasDiffMode(data, 'raw') ? jsx(Button, { variant: effMode === 'raw' ? 'default' : 'outline', size: 'sm', onClick: function() { setDiffMode('raw') }, children: 'Raw' }) : null,
    ] }) : null,
    effMode === 'semantic' && hasDiffMode(data, 'semantic') ? jsx(SemanticDiffView, { data: data.semantic_diff }) : null,
    effMode === 'split' && hasDiffMode(data, 'split') ? jsx(SplitDiffView, { before: data.before, after: data.after }) : null,
    effMode === 'raw' && hasDiffMode(data, 'raw') ? jsx(RawDiffView, { diff: data.diff || data.raw_diff }) : null,
    !hasDiffMode(data, 'semantic') && !hasDiffMode(data, 'split') && !hasDiffMode(data, 'raw') && data.content ? jsx(MarkdownView, { content: data.content }) : null,
    !hasDiffMode(data, 'semantic') && !hasDiffMode(data, 'split') && !hasDiffMode(data, 'raw') && !data.content ? jsx(EmptyState, { title: 'No diff data', description: 'No diff representation available for this file.' }) : null,
  ] })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════════

function OpenSpecPage({ api }) {
  var sourcesQuery = useQuery({
    queryKey: ['openspec', 'sources'],
    queryFn: function() { return api.sources() },
  })

  var [selectedSourceId, setSelectedSourceId] = React.useState(null)
  var [view, setView] = React.useState('work')
  var [selectedItem, setSelectedItem] = React.useState(null) // {item, sourceId, type}

  // Auto-select first valid source
  var sources = (sourcesQuery.data && sourcesQuery.data.sources) || []
  React.useEffect(function() {
    if (sources.length > 0 && selectedSourceId === null) {
      var valid = selectFirstValid(sources)
      if (valid) setSelectedSourceId(valid.id)
    }
  }, [sources, selectedSourceId])

  // Close detail on source change
  React.useEffect(function() {
    setSelectedItem(null)
  }, [selectedSourceId])

  var selectedSource = sources.find(function(s) { return s.id === selectedSourceId }) || null

  if (sourcesQuery.isLoading) return jsx(Loader, { type: 'lemniscate-bloom' })
  if (sourcesQuery.error) return jsx(ErrorState, { title: 'Failed to load sources', description: sourcesQuery.error.message, onRetry: function() { sourcesQuery.refetch() } })
  if (sources.length === 0) return jsx(EmptyState, { title: 'No sources registered', description: 'Register a source via the CLI or dashboard to get started.' })

  var onSelectItem = function(item) {
    setSelectedItem({ item: item, sourceId: selectedSourceId, type: item._type || 'change' })
  }

  return jsxs('div', { className: cn('flex flex-col h-full'), children: [
    // Header
    jsxs('div', { style: { padding: '12px 16px', borderBottom: '1px solid var(--ui-border, #333)', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }, children: [
      jsx('h1', { style: { fontSize: '16px', fontWeight: 600, margin: 0, color: 'var(--foreground, #e0e0e0)' }, children: 'OpenSpec' }),
      jsx(Select, {
        value: selectedSourceId || undefined,
        onValueChange: function(v) { setSelectedSourceId(v) },
        children: [
          jsx(SelectTrigger, { children: jsx(SelectValue, { placeholder: 'Select source' }) }),
          jsx(SelectContent, { children: sources.map(function(s) {
            return jsx(SelectItem, { value: s.id, children: (s.name || s.id) + (s.valid === false ? ' (invalid)' : '') }, s.id)
          }) })
        ]
      }),
      jsx(Button, { variant: 'outline', size: 'sm', onClick: function() { sourcesQuery.refetch() }, children: 'Refresh' }),
      selectedSource && selectedSource.openspec && selectedSource.openspec.counts ? jsxs('div', { style: { display: 'flex', gap: '6px', fontSize: '12px', color: 'var(--muted-foreground, #888)' }, children: [
        selectedSource.openspec.counts.changes != null ? jsx(Badge, { variant: 'outline', children: selectedSource.openspec.counts.changes + ' changes' }) : null,
        selectedSource.openspec.counts.ideas != null ? jsx(Badge, { variant: 'outline', children: selectedSource.openspec.counts.ideas + ' ideas' }) : null,
        selectedSource.openspec.counts.specs != null ? jsx(Badge, { variant: 'outline', children: selectedSource.openspec.counts.specs + ' specs' }) : null,
      ] }) : null,
      selectedSource && selectedSource.path ? jsx('span', { style: { fontSize: '11px', color: 'var(--muted-foreground, #666)', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px', fontFamily: 'monospace' }, title: selectedSource.path, children: selectedSource.path }) : null,
    ] }),

    // View switch
    jsx('div', { style: { padding: '8px 16px', borderBottom: '1px solid var(--ui-border, #333)' }, children: jsx(SegmentedControl, {
      value: view,
      onChange: setView,
      options: [
        { id: 'work', label: 'Work' },
        { id: 'specs', label: 'Specs' },
      ]
    }) }),

    // Invalid source warning
    selectedSource && selectedSource.valid === false ? jsx('div', { style: { padding: '12px 16px', background: 'var(--warning-background, #fff3cd)', borderRadius: '4px', margin: '8px 16px', fontSize: '13px' }, children: jsxs('div', { children: [
      jsx('strong', { children: 'Invalid source' }),
      selectedSource.error ? ': ' + selectedSource.error : '',
      selectedSource.path ? jsxs('div', { style: { fontFamily: 'monospace', fontSize: '11px', marginTop: '4px', opacity: 0.7 }, children: ['Path: ', selectedSource.path] }) : null,
    ] }) }) : null,

    // View body
    jsx('div', { style: { flex: 1, overflow: 'hidden', padding: '12px 16px' }, children: selectedSource && selectedSource.valid !== false ? (
      view === 'work'
        ? jsx(WorkView, { api: api, source: selectedSource, sourceToken: selectedSource.token, onSelectItem: onSelectItem })
        : jsx(SpecsView, { api: api, sourceId: selectedSource.id })
    ) : selectedSource && selectedSource.valid === false ? null : jsx(EmptyState, { title: 'Select a source', description: 'Choose a source to view its OpenSpec project.' }) }),

    // Detail dialog — synchronous gate: reject stale item from different source
    selectedItem && selectedItem.sourceId === selectedSourceId && selectedItem.type === 'change' && selectedSource && selectedSource.valid !== false ? jsx(ChangeDetailDialog, { api: api, sourceId: selectedSourceId, change: selectedItem.item, onClose: function() { setSelectedItem(null) } }) : null,
    selectedItem && selectedItem.sourceId === selectedSourceId && selectedItem.type === 'idea' && selectedSource && selectedSource.valid !== false ? jsx(IdeaDetailDialog, { api: api, sourceId: selectedSourceId, idea: selectedItem.item, onClose: function() { setSelectedItem(null) } }) : null,
  ] })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugin definition
// ═══════════════════════════════════════════════════════════════════════════════

var plugin = {
  id: 'openspec',
  name: 'OpenSpec',
  description: 'OpenSpec read-only project surface — sources, changes, ideas, specs, and diffs.',
  register: function(ctx) {
    var api = createApi(ctx)
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/openspec' },
        render: function() { return jsx(OpenSpecPage, { api: api }) }
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 50,
        data: { codicon: 'list-tree', label: 'OpenSpec', path: '/openspec' }
      }
    ])
  }
}

export default plugin
export const __test = Object.freeze({
  sourcesPath: sourcesPath,
  changePath: changePath,
  ideaPath: ideaPath,
  specBrowserPath: specBrowserPath,
  specPath: specPath,
  selectFirstValid: selectFirstValid,
  normalizeStatus: normalizeStatus,
  groupByStatus: groupByStatus,
  sortItems: sortItems,
  filterItems: filterItems,
  toggleArchived: toggleArchived,
  parseTasks: parseTasks,
  renderMarkdown: renderMarkdown,
  classifyState: classifyState,
  classifyDiffLine: classifyDiffLine,
  hasDiffMode: hasDiffMode,
  normalizeSemanticGroups: normalizeSemanticGroups,
  effectiveDiffMode: effectiveDiffMode,
  isSafeUrl: isSafeUrl,
  renderInline: renderInline,
  MarkdownElement: MarkdownElement,
})
