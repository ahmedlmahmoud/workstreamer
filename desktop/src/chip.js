/** @section chip */
import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  StatusDot,
  Tip,
  cn,
  haptic,
  host,
  useQuery,
  useQueryClient,
  useValue,
} from '@hermes/plugin-sdk'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState } from 'react'
import {
  BlockerList,
  CoreChecklist,
  HealthBadge,
  MilestoneRail,
  Muted,
  SectionLabel,
  UrlPills,
  ViolationList,
} from './atoms.js'
import { ID } from './constants.js'
import { ago, errMsg, extractStreamName, titleCase } from './format.js'
import { healthMeta } from './health.js'

function chipLabel(streamName, data, isFetching) {
  if (!data) return isFetching ? `${streamName} · …` : `${streamName} · …`
  const hm = healthMeta(data.health)
  const down = data.down_url_count || 0
  const viol = data.check?.violation_count || 0
  if (data.check?.status === 'dirty' && viol) return `${streamName} · ${viol} viol`
  if (down > 0) return `${streamName} · ${down} down`
  if (data.stale) return `${streamName} · stale`
  if (data.focus_label && ['degraded', 'active', 'dirty', 'stale'].includes(data.health)) {
    return `${streamName} · ${data.focus_label}`
  }
  return `${streamName} · ${hm.short}`
}

export function WorkstreamChip({ ctx }) {
  const cwd = useValue(host.state.cwd)
  const profile = useValue(host.state.profile)
  const streamFromCwd = extractStreamName(cwd)
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  // Resolve: prefer cwd stream; if missing, ask backend via profile
  const { data: resolved } = useQuery({
    queryKey: [ID, 'resolve', streamFromCwd || '', profile || ''],
    queryFn: async () => {
      if (streamFromCwd) return { stream: streamFromCwd, source: 'cwd' }
      const q = new URLSearchParams()
      if (profile) q.set('profile', String(profile))
      if (cwd) q.set('cwd', String(cwd))
      return ctx.rest(`/resolve?${q}`)
    },
    refetchInterval: 30_000,
    retry: 1,
  })

  const streamName = resolved?.stream || streamFromCwd

  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: [ID, 'stream', streamName || 'none'],
    queryFn: async () => {
      if (!streamName) return null
      return ctx.rest(
        `/stream?stream=${encodeURIComponent(streamName)}&check=true`
      )
    },
    enabled: Boolean(streamName),
    refetchInterval: 45_000,
    retry: 1,
  })

  if (!streamName) {
    return jsx(Tip, {
      label: 'No workstream in cwd — open map',
      children: jsxs('button', {
        type: 'button',
        className:
          'inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] transition-colors',
        style: { color: 'var(--ui-text-quaternary)' },
        onClick: () => {
          haptic('tap')
          host.navigate('/workstream-map')
        },
        children: [
          jsx(StatusDot, { tone: 'muted' }),
          'no stream',
        ],
      }),
    })
  }

  const hm = healthMeta(data?.health)
  const label = chipLabel(streamName, data, isFetching)
  const tipBits = [
    data?.title || titleCase(streamName),
    data?.pulse?.next_action ? `Next: ${data.pulse.next_action}` : data?.focus_label,
    data?.check?.summary_line,
    isError ? `Error: ${errMsg(error)}` : null,
  ].filter(Boolean)

  return jsx(Popover, {
    open,
    onOpenChange: setOpen,
    children: [
      // Plain button trigger (no Tip-asChild nesting — Tip doesn't forward refs reliably).
      jsx(PopoverTrigger, {
        key: 'trigger',
        children: jsxs('button', {
          type: 'button',
          title: tipBits.join(' · ') || streamName,
          className: cn(
            'inline-flex h-full max-w-[240px] items-center gap-1.5 rounded-none px-1.5',
            'text-[0.6875rem] tabular-nums transition-colors',
            'hover:bg-(--chrome-action-hover)'
          ),
          style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
          children: [
            jsx(StatusDot, { tone: isError ? 'bad' : hm.tone }),
            jsx('span', { className: 'truncate', children: label }),
            isFetching
              ? jsx('span', {
                  className: 'text-[9px] opacity-60',
                  children: '…',
                })
              : null,
          ],
        }),
      }),
      jsx(PopoverContent, {
        key: 'content',
        className: 'w-80 p-0',
        align: 'end',
        children: jsx(StreamPopover, {
          streamName,
          data,
          profile,
          isError,
          error,
          isFetching,
          onClose: () => setOpen(false),
          onRefresh: async () => {
            haptic('tap')
            try {
              await ctx.rest(
                `/stream?stream=${encodeURIComponent(streamName)}&check=true&force=true`
              )
            } catch {
              /* refetch below surfaces error */
            }
            await refetch()
            qc.invalidateQueries({ queryKey: [ID, 'list'] })
          },
        }),
      }),
    ],
  })
}

function StreamPopover({
  streamName,
  data,
  profile,
  isError,
  error,
  isFetching,
  onClose,
  onRefresh,
}) {
  const pulse = data?.pulse
  const check = data?.check
  const core = data?.core
  const hm = healthMeta(data?.health)
  const title = data?.title || titleCase(streamName)

  if (isError && !data) {
    return jsxs('div', {
      className: 'p-3 flex flex-col gap-2',
      children: [
        jsx('div', {
          className: 'text-xs font-semibold',
          style: { color: 'var(--destructive)' },
          children: 'Failed to load stream',
        }),
        jsx('div', {
          className: 'text-xs break-words',
          style: { color: 'var(--ui-text-secondary)' },
          children: errMsg(error),
        }),
        jsxs('div', {
          className: 'flex gap-1.5',
          children: [
            jsx(Button, {
              size: 'sm',
              variant: 'secondary',
              onClick: onRefresh,
              children: 'Retry',
            }),
            jsx(Button, {
              size: 'sm',
              variant: 'ghost',
              onClick: onClose,
              children: 'Close',
            }),
          ],
        }),
      ],
    })
  }

  return jsxs('div', {
    className: 'flex flex-col',
    children: [
      // Header
      jsxs('div', {
        className: 'px-3 pt-3 pb-2 flex flex-col gap-1',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between gap-2',
            children: [
              jsxs('div', {
                className: 'flex items-center gap-2 min-w-0',
                children: [
                  jsx(StatusDot, { tone: hm.tone }),
                  jsx('span', {
                    className: 'font-semibold text-sm truncate',
                    children: title,
                  }),
                ],
              }),
              jsxs('div', {
                className: 'flex items-center gap-1 shrink-0',
                children: [
                  data?.profile
                    ? jsx(Badge, {
                        variant: 'muted',
                        size: 'xs',
                        children: `@${data.profile}`,
                      })
                    : null,
                  jsx(HealthBadge, { health: data?.health }),
                ],
              }),
            ],
          }),
          pulse?.next_action
            ? jsxs('div', {
                className: 'text-xs leading-snug',
                style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
                children: [
                  jsx('span', {
                    style: { color: 'var(--ui-text-quaternary)' },
                    children: 'Next · ',
                  }),
                  pulse.next_action,
                ],
              })
            : data?.focus_label
              ? jsx(Muted, { children: `Focus · ${data.focus_label}` })
              : null,
          jsxs('div', {
            className: 'flex items-center gap-2 flex-wrap',
            children: [
              pulse?.updated
                ? jsx(Muted, {
                    children: `STATUS-LIVE · ${pulse.updated}${pulse.stale ? ' · STALE' : ''}`,
                  })
                : null,
              check?.checked_at
                ? jsx(Muted, { children: `Checked ${ago(check.checked_at)}` })
                : null,
              data?.overall_pct != null
                ? jsx(Muted, { children: `${data.overall_pct}% overall` })
                : null,
            ],
          }),
        ],
      }),

      jsx(Separator, {}),

      pulse?.milestone_chips?.length
        ? jsxs('div', {
            className: 'px-3 py-2 flex flex-col gap-1.5',
            children: [
              jsx(SectionLabel, { children: 'Milestones' }),
              jsx(MilestoneRail, { chips: pulse.milestone_chips }),
            ],
          })
        : null,

      pulse?.urls?.length
        ? jsxs('div', {
            className: 'px-3 py-2 flex flex-col gap-1.5',
            children: [
              jsx(SectionLabel, { children: 'Live URLs' }),
              jsx(UrlPills, { urls: pulse.urls }),
            ],
          })
        : null,

      jsxs('div', {
        className: 'px-3 py-2 flex flex-col gap-1.5',
        children: [
          jsx(SectionLabel, { children: 'Blockers' }),
          jsx(BlockerList, { blockers: pulse?.blockers }),
        ],
      }),

      pulse?.prs?.length
        ? jsxs('div', {
            className: 'px-3 py-2 flex flex-col gap-1',
            children: [
              jsx(SectionLabel, { children: 'Open PRs' }),
              jsx('div', {
                className: 'flex flex-col gap-0.5',
                children: pulse.prs.slice(0, 4).map((pr, i) =>
                  jsx('div', {
                    key: i,
                    className: 'text-xs truncate',
                    style: {
                      color: 'var(--ui-text-secondary, var(--muted-foreground))',
                    },
                    children: pr,
                  })
                ),
              }),
            ],
          })
        : null,

      jsx(Separator, {}),

      jsxs('div', {
        className: 'px-3 py-2 flex flex-col gap-2',
        children: [
          jsx(SectionLabel, { children: 'Constitution' }),
          jsx(CoreChecklist, { core }),
          jsx(ViolationList, { check }),
        ],
      }),

      jsx(Separator, {}),

      jsxs('div', {
        className: 'flex gap-1.5 p-2',
        children: [
          jsx(Button, {
            size: 'sm',
            variant: 'secondary',
            className: 'flex-1',
            disabled: isFetching,
            onClick: onRefresh,
            children: isFetching ? '…' : 'Recheck',
          }),
          jsx(Button, {
            size: 'sm',
            variant: 'secondary',
            className: 'flex-1',
            onClick: () => {
              haptic('tap')
              onClose()
              host.navigate('/workstream-map')
            },
            children: 'Map',
          }),
          jsx(Button, {
            size: 'sm',
            variant: 'ghost',
            onClick: () => {
              haptic('tap')
              onClose()
            },
            children: '✕',
          }),
        ],
      }),
    ],
  })
}
