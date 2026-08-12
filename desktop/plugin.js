/**
 * workstreamer — Desktop UI half.
 * Status bar chip + hover popover + palette + Workstream Map pane.
 */
import {
  Button,
  PALETTE_AREA,
  ROUTES_AREA,
  Separator,
  StatusDot,
  Popover,
  PopoverTrigger,
  PopoverContent,
  cn,
  haptic,
  host,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'

const ID = 'workstreamer'

function extractStreamName(cwd) {
  if (!cwd) return null
  const m = cwd.match(/workstreams\/([^/]+)/)
  return m ? m[1] : null
}

function WorkstreamChip({ ctx }) {
  const cwd = useValue(host.state.cwd)
  const streamName = extractStreamName(cwd)
  const [popoverOpen, setPopoverOpen] = useState(false)

  if (!streamName) {
    return jsx('span', {
      className: 'text-xs',
      style: { color: 'var(--ui-text-quaternary)' },
      children: '\u2014 \u00b7 no stream'
    })
  }

  return jsx(Popover, {
    open: popoverOpen,
    onOpenChange: setPopoverOpen,
    children: [
      jsx(PopoverTrigger, {
        key: 'trigger',
        children: jsxs('span', {
          className: 'flex items-center gap-1 cursor-pointer text-xs',
          style: { color: 'var(--ui-text-secondary)' },
          children: [
            jsx(StatusDot, { color: 'green' }),
            `${streamName} \u00b7 clean`
          ]
        })
      }),
      jsx(PopoverContent, {
        key: 'content',
        className: 'w-72 p-3',
        children: jsx(StreamPopover, { streamName, ctx, onClose: () => setPopoverOpen(false) })
      })
    ]
  })
}

function StreamPopover({ streamName, ctx, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['workstreamer', 'check', streamName],
    queryFn: () => ctx.rest('/check', { params: { stream: streamName } }).catch(() => null),
    refetchInterval: 60_000,
  })

  return jsxs('div', {
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between mb-2',
        children: [
          jsx('span', { className: 'font-semibold text-sm', children: streamName }),
          jsx('span', {
            className: 'text-xs',
            style: { color: 'var(--ui-text-quaternary)' },
            children: 'docs+app'
          })
        ]
      }),
      jsx(Separator, {}),
      isLoading
        ? jsx('div', { className: 'py-4 text-center text-xs', style: { color: 'var(--ui-text-quaternary)' }, children: 'Checking...' })
        : jsx(ViolationsList, { data }),
      jsx(Separator, {}),
      jsxs('div', {
        className: 'flex gap-2 mt-2',
        children: [
          jsx(Button, {
            size: 'sm',
            variant: 'secondary',
            onClick: () => { haptic('tap'); onClose(); }
          }, 'Check now'),
          jsx(Button, {
            size: 'sm',
            variant: 'secondary',
            onClick: () => { haptic('tap'); onClose(); host.navigate('/workstream-map'); }
          }, 'Map')
        ]
      })
    ]
  })
}

function ViolationsList({ data }) {
  if (!data || data.status === 'clean') {
    return jsx('div', {
      className: 'py-4 text-center text-xs',
      style: { color: 'var(--ui-green)' },
      children: '\u2713 Clean \u2014 no violations'
    })
  }
  const lines = (data.output || '').split('\n').filter(l => l.includes('VIOLATION') || l.includes('WARNING'))
  if (lines.length === 0) {
    return jsx('div', { className: 'py-4 text-center text-xs', style: { color: 'var(--ui-green)' }, children: '\u2713 Clean \u2014 no violations' })
  }
  return jsx('div', { className: 'py-2', children: lines.slice(0, 5).map((l, i) =>
    jsx('div', {
      key: i,
      className: 'text-xs py-1',
      style: { color: l.includes('VIOLATION') ? 'var(--ui-red)' : 'var(--ui-amber)' },
      children: l.trim()
    })
  )})
}

function WorkstreamMap({ ctx }) {
  const { data, isLoading } = useQuery({
    queryKey: ['workstreamer', 'list'],
    queryFn: () => ctx.rest('/list').catch(() => ({ streams: [] })),
    refetchInterval: 120_000,
  })

  if (isLoading) {
    return jsx('div', { className: 'p-4 text-xs', style: { color: 'var(--ui-text-quaternary)' }, children: 'Loading...' })
  }

  const streams = data?.streams || []
  const cwd = useValue(host.state.cwd)
  const activeStream = extractStreamName(cwd)

  return jsxs('div', { className: 'flex flex-col h-full', children: [
    jsx('div', { className: 'flex-1 overflow-auto', children:
      streams.map(s => {
        const isActive = s.name === activeStream
        const dotColor = s.has_guide ? (s.has_checker ? 'green' : 'amber') : 'red'
        return jsxs('div', {
          key: s.name,
          className: cn('flex items-center gap-2 px-3 py-1.5 text-xs', isActive && 'bg-accent/10'),
          children: [
            jsx(StatusDot, { color: isActive ? 'blue' : dotColor }),
            jsx('span', { className: 'flex-1', children: s.name }),
            s.profile ? jsx('span', { className: 'text-[10px]', style: { color: 'var(--ui-text-quaternary)' }, children: `@${s.profile}` }) : null,
            s.has_checker ? jsx(Button, { size: 'xs', variant: 'ghost', children: 'check' }) : null
          ]
        })
      })
    }),
    jsx(Separator, {}),
    jsxs('div', { className: 'flex gap-1 p-2', children: [
      jsx(StatusDot, { color: 'blue' }), jsx('span', { className: 'text-[10px]', children: 'active' }),
      jsx(StatusDot, { color: 'green' }), jsx('span', { className: 'text-[10px]', children: 'guide' }),
      jsx(StatusDot, { color: 'red' }), jsx('span', { className: 'text-[10px]', children: 'no guide' }),
    ]})
  ]})
}

export default {
  id: ID,
  name: 'Workstreamer',
  defaultEnabled: true,

  register(ctx) {
    ctx.register({
      id: 'ws-status',
      area: 'statusBar.right',
      order: 90,
      render: () => jsx(WorkstreamChip, { ctx }),
    })

    ctx.register({
      id: 'ws-check',
      area: PALETTE_AREA,
      data: { label: 'Workstreamer: Check Stream', codicon: 'check' },
      render: () => { haptic('tap') }
    })
    ctx.register({
      id: 'ws-pulse',
      area: PALETTE_AREA,
      data: { label: 'Workstreamer: Pulse', codicon: 'pulse' },
      render: () => { haptic('tap') }
    })
    ctx.register({
      id: 'ws-map',
      area: PALETTE_AREA,
      data: { label: 'Workstreamer: Show Map', codicon: 'project' },
      render: () => host.navigate('/workstream-map')
    })

    ctx.register({
      id: 'workstream-map',
      area: 'panes',
      title: 'Workstream Map',
      data: {
        placement: 'right',
        width: '300px',
      },
      render: () => jsx(WorkstreamMap, { ctx }),
    })

    ctx.register({
      id: 'workstream-map-page',
      area: ROUTES_AREA,
      data: { path: '/workstream-map' },
      render: () => jsx(WorkstreamMap, { ctx }),
    })
  },
}