/** @section entry */
import {
  KEYBINDS_AREA,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  haptic,
  host,
} from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'
import { WorkstreamChip } from './chip.js'
import { ID } from './constants.js'
import { errMsg, extractStreamName, hostCwd } from './format.js'
import { WorkstreamPage } from './map.js'

async function runCheckNotify(ctx) {
  haptic('tap')
  const name = extractStreamName(hostCwd())
  if (!name) {
    host.notify({ kind: 'info', message: 'Not inside a workstream — opening page' })
    host.navigate('/workstream-map')
    return
  }
  try {
    const r = await ctx.rest(
      `/check?stream=${encodeURIComponent(name)}&force=true`
    )
    const n = r.violation_count || 0
    host.notify({
      kind: n ? 'error' : 'success',
      message: n
        ? `${name}: ${n} violation${n === 1 ? '' : 's'}`
        : `${name}: ${r.summary_line || 'clean'}`,
    })
  } catch (e) {
    host.notify({ kind: 'error', message: errMsg(e) })
  }
}

async function runPulseNotify(ctx) {
  haptic('tap')
  const name = extractStreamName(hostCwd())
  if (!name) {
    host.navigate('/workstream-map')
    return
  }
  try {
    const r = await ctx.rest(`/pulse?stream=${encodeURIComponent(name)}`)
    const p = r.pulse
    if (!p) {
      host.notify({ kind: 'info', message: `${name}: no STATUS-LIVE.md` })
      return
    }
    const next = p.next_action || p.focus?.short_id || p.focus?.id || 'no next action'
    const down = (p.down_urls || []).map(u => u.name).join(', ')
    host.notify({
      kind: down ? 'error' : 'info',
      message: down ? `${name}: next=${next} · down=${down}` : `${name}: next=${next}`,
    })
  } catch (e) {
    host.notify({ kind: 'error', message: errMsg(e) })
  }
}

const plugin = {
  id: ID,
  name: 'Workstreamer',
  description:
    'Workstream constitution + live STATUS pulse — status chip and fleet page.',
  defaultEnabled: true,

  register(ctx) {
    const openPage = () => {
      haptic('tap')
      host.navigate('/workstream-map')
    }

    ctx.register({
      id: 'ws-status',
      area: STATUSBAR_AREAS.right,
      order: 90,
      render: () => jsx(WorkstreamChip, { ctx }),
    })

    ctx.register({
      id: 'ws-nav',
      area: SIDEBAR_NAV_AREA,
      order: 55,
      data: {
        path: '/workstream-map',
        label: 'Workstreams',
        codicon: 'symbol-structure',
      },
    })

    // Full page only — no always-on right rail. Open via sidebar / chip / palette.
    ctx.register({
      id: 'workstream-map-page',
      area: ROUTES_AREA,
      data: { path: '/workstream-map' },
      render: () =>
        jsx('div', {
          className: 'h-full w-full min-h-0 min-w-0',
          children: jsx(WorkstreamPage, { ctx }),
        }),
    })

    ctx.register({
      id: 'ws-check',
      area: PALETTE_AREA,
      data: {
        id: 'workstreamer.check',
        action: 'workstreamer.check',
        label: 'Workstreamer: Recheck current stream',
        keywords: ['workstream', 'check', 'constitution', 'violations', 'ws'],
        codicon: 'check',
        run: () => runCheckNotify(ctx),
      },
    })
    ctx.register({
      id: 'ws-pulse',
      area: PALETTE_AREA,
      data: {
        id: 'workstreamer.pulse',
        action: 'workstreamer.pulse',
        label: 'Workstreamer: Pulse current stream',
        keywords: ['workstream', 'pulse', 'status', 'milestones', 'ws'],
        codicon: 'pulse',
        run: () => runPulseNotify(ctx),
      },
    })
    ctx.register({
      id: 'ws-map',
      area: PALETTE_AREA,
      data: {
        id: 'workstreamer.map',
        action: 'workstreamer.map',
        label: 'Workstreamer: Open page',
        keywords: ['workstream', 'map', 'fleet', 'ws', 'page'],
        codicon: 'project',
        run: openPage,
      },
    })

    ctx.register({
      id: 'ws-map-key',
      area: KEYBINDS_AREA,
      data: {
        id: 'workstreamer.map',
        label: 'Workstreamer: Open page',
        default: 'mod+alt+w',
        run: openPage,
      },
    })
    ctx.register({
      id: 'ws-check-key',
      area: KEYBINDS_AREA,
      data: {
        id: 'workstreamer.check',
        label: 'Workstreamer: Recheck',
        default: 'mod+alt+c',
        run: () => runCheckNotify(ctx),
      },
    })
  },
}

export default plugin
