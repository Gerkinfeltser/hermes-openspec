/**
 * OpenSpec Desktop runtime plugin — read-only spike.
 *
 * Registers /openspec route + sidebar nav entry. Calls ctx.rest('/sources')
 * to fetch registered sources from the existing OpenSpec backend and renders
 * them with loading/error/empty states. No writes, no new backend.
 *
 * Packaging: ships as desktop/plugin.js inside the openspec agent-plugin
 * package. Runtime loader scans ~/.hermes/plugins/openspec/desktop/plugin.js.
 */

import { cn, EmptyState, ErrorState, Loader, ROUTES_AREA, SIDEBAR_NAV_AREA, useQuery } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

function SourcesList({ sources }) {
  if (!sources || sources.length === 0) {
    return jsx(EmptyState, {
      title: 'No sources registered',
      description: 'Register a source via the CLI or dashboard to get started.'
    })
  }

  return jsxs('div', {
    className: cn('flex flex-col gap-2 p-4'),
    children: [
      jsxs('h2', {
        className: cn('text-lg font-semibold text-foreground'),
        children: ['Registered Sources']
      }),
      jsx('ul', {
        className: cn('flex flex-col gap-1'),
        children: sources.map(source =>
          jsxs('li', {
            className: cn(
              'flex items-center justify-between rounded-md border border-(--ui-border) px-3 py-2',
              'text-sm'
            ),
            children: [
              jsxs('span', {
                className: cn('font-medium text-foreground'),
                children: [source.name || source.id || 'Unknown']
              }),
              jsxs('span', {
                className: cn('text-muted-foreground'),
                children: [source.valid ? source.path : `Invalid: ${source.error || 'unknown'}`]
              })
            ]
          }, source.id || source.token || source.path)
        )
      })]
  })
}

function OpenSpecPage({ api }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['openspec', 'sources'],
    queryFn: () => api.rest('/sources')
  })

  if (isLoading) {
    return jsx(Loader, { type: 'lemniscate-bloom' })
  }

  if (error) {
    return jsx(ErrorState, {
      title: 'Failed to load sources',
      description: error.message || 'Could not reach the OpenSpec backend.'
    })
  }

  const sources = data?.sources ?? []
  return jsx(SourcesList, { sources })
}

const plugin = {
  id: 'openspec',
  name: 'OpenSpec',
  description: 'OpenSpec source registry — view registered sources in Hermes Desktop.',
  register(ctx) {
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/openspec' },
        render: () => jsx(OpenSpecPage, { api: ctx })
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
