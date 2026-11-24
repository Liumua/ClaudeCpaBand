import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { CpaSnapshot, LastTurn, Placement, Prefs, Style } from '../types'
import { isPlacement, isStyle, PLACEMENTS, positive, statusLine, STYLES } from './format'
import { glance, render } from './view'
import type { Actions, Els, View } from './view'

const cpa = atom({ plugin: 'cpa-band', key: 'cpa' } as const, null)
const isLoading = atom({ plugin: 'cpa-band', key: 'isLoading' } as const, false)
const lastTurn = atom({ plugin: 'cpa-band', key: 'lastTurn' } as const, null)
const isFolded = atom({ plugin: 'cpa-band', key: 'isFolded' } as const, false)
const isSettingsOpen = atom({ plugin: 'cpa-band', key: 'isSettingsOpen' } as const, false)
const prefs = atom({ plugin: 'cpa-band', key: 'prefs' } as const, { style: 'classic', placement: 'above' } as Prefs)

const PANE = 'cpa-band'
const TICK_MS = 15_000

// What the person picked in the band or with /cpa-band, and the /config values it was
// picked under: once /config changes, its values win again.
type StoredPrefs = Prefs & { config: Prefs }

// Set by register from its options; read by the functions below.
let cacheTtlMs = 60 * 60_000
let priceMultiplier = 1
let configPrefs: Prefs = { style: 'classic', placement: 'above' }
let refreshMs = 120_000
let isRunning = false
// This copy of the module has started its command and timers. A reload starts the
// module over without always raising session.start again, so later events start it too.
let isStarted = false
// The columns the band and the pane last reported, written to the store when they change:
// what a drawing's pixel width is reckoned from.
const seenColumns: Record<string, number> = {}
let savedColumns = ''

// Runs scripts/fetch.ps1 and stores what it printed; one run at a time.
async function refresh($: EngineInterface) {
  if (isRunning) return
  isRunning = true
  await update($, isLoading, () => true)
  let snapshot: CpaSnapshot
  try {
    const script = `${$.plugin.root}/scripts/fetch.ps1`
    const { stdout } = await $.process.run(
      ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { timeoutMs: 60_000 },
    )
    const parsed = JSON.parse(stdout.trim()) as Partial<CpaSnapshot>
    snapshot = {
      usage: null, usageError: null, quota: null, quotaError: null,
      ...parsed,
      fetchedAt: await $.clock.now(),
    }
  } catch {
    snapshot = {
      error: 'run-failed', usage: null, usageError: null, quota: null, quotaError: null,
      fetchedAt: await $.clock.now(),
    }
  } finally {
    isRunning = false
  }
  await update($, cpa, () => snapshot)
  await update($, isLoading, () => false)
  await updateStatus($)
}

// Everything a drawing shows, read at one moment.
async function gather($: EngineInterface, surface: RenderSurface): Promise<View> {
  const [snapshot, loading, turn, folded, settingsOpen, picked, usage, now] = await Promise.all([
    read($, cpa), read($, isLoading), read($, lastTurn), read($, isFolded), read($, isSettingsOpen),
    read($, prefs), $.session.usage(), $.clock.now(),
  ])
  return {
    surface,
    snapshot,
    isLoading: loading,
    isFolded: folded,
    isSettingsOpen: settingsOpen,
    prefs: picked,
    now,
    model: turn?.model ?? (await $.session.model()),
    ctx: usage.context,
    cost: usage.cost ? usage.cost.usd * priceMultiplier : null,
    cacheLeft: turn ? cacheTtlMs - (now - turn.endedAt) : null,
    turnMs: turn?.durationMs ?? null,
    columns: 120,
    canFold: true,
  }
}

// Keeps the status line in step while it is the chosen place; clears it otherwise.
async function updateStatus($: EngineInterface) {
  const picked = await read($, prefs)
  if (picked.placement !== 'status') {
    $.ui.status(undefined)
    return
  }
  const v = await gather($, 'terminal')
  $.ui.status(statusLine(v.snapshot, { model: v.model, ctxPercent: v.ctx.percent, cost: v.cost, cacheLeft: v.cacheLeft }))
}

// Opens or closes the pane to match the placement; the band and status line follow on their own.
async function applyPlacement($: EngineInterface, placement: Placement) {
  if (placement === 'pane' || placement === 'widget') {
    // The widget asks for the small seat and a small block; where the surface has no widgets
    // it opens as a pane, and the widget's own compact drawing still tells the two apart.
    await $.ui.open(
      placement === 'widget'
        // Cast: types laid by an engine older than widgets lack `placement`.
        ? ({ id: PANE, title: 'CPA 额度', placement: 'widget', rows: 8, columns: 32 } as Parameters<EngineInterface['ui']['open']>[0])
        : { id: PANE, title: 'CPA' },
    )
  } else {
    await $.ui.close({ id: PANE })
  }
  await updateStatus($)
}

async function setPrefs($: EngineInterface, change: Partial<Prefs>) {
  const before = await read($, prefs)
  const after: Prefs = { ...before, ...change }
  await update($, prefs, () => after)
  if (after.placement !== before.placement) await applyPlacement($, after.placement)
  $.ui.invalidate('ui.render')
  // Kept for new sessions; a failed write still leaves this session switched.
  const stored: StoredPrefs = { ...after, config: configPrefs }
  await $.store.set('prefs', stored).catch(() => undefined)
}

// The picks saved earlier, unless /config has changed since they were made.
async function loadPrefs($: EngineInterface): Promise<Prefs> {
  const saved = (await $.store.get('prefs')) as Partial<StoredPrefs> | undefined
  const sameConfig =
    saved?.config?.style === configPrefs.style && saved.config.placement === configPrefs.placement
  if (sameConfig && isStyle(saved.style) && isPlacement(saved.placement)) {
    return { style: saved.style, placement: saved.placement }
  }
  return configPrefs
}

// A value or label from STYLES / PLACEMENTS, as typed after /cpa-band.
function pick<T extends string>(list: readonly { value: T; label: string }[], word: string): T | undefined {
  return list.find(item => item.value === word || item.label === word)?.value
}

function help(current: Prefs): string {
  const styles = STYLES.map(s => `${s.value}(${s.label})`).join(' ')
  const places = PLACEMENTS.map(p => `${p.value}(${p.label})`).join(' ')
  return [
    `当前：样式 ${current.style}，位置 ${current.placement}`,
    `/cpa-band style <样式>   ${styles}`,
    `/cpa-band place <位置>   ${places}`,
    '/cpa-band refresh       立即刷新 CPA 数据',
  ].join('\n')
}

function actions($: EngineInterface): Actions {
  return {
    refresh: () => void refresh($),
    toggleFold: () => void update($, isFolded, f => !f),
    toggleSettings: () => void update($, isSettingsOpen, o => !o),
    setStyle: value => void (isStyle(value) && setPrefs($, { style: value })),
    setPlacement: value => void (isPlacement(value) && setPrefs($, { placement: value })),
  }
}

function elements($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0]): Els {
  const table = $.ui.resolve(e)
  return {
    Box: table.Box,
    Text: table.Text,
    Button: table.Button,
    Select: 'Select' in table ? table.Select : undefined,
    // By surface: the terminal's table answers Svg too, but draws only its alt text.
    Svg: e.surface !== 'terminal' && 'Svg' in table ? table.Svg : undefined,
  }
}

// Registers /cpa-band, starts the timers and seats the band; once per copy of the module.
// At a session's start it takes the saved picks; after a reload it keeps the session's.
async function ensureStarted($: EngineInterface, isSessionStart: boolean) {
  if (isStarted) return
  isStarted = true
  let commandError: string | null = null
  try {
    await $.command.register({
      name: 'cpa-band',
      description: '切换 CPA 横条的样式和位置',
      argumentHint: 'style <样式> | place <位置> | refresh',
    })
  } catch (err) {
    commandError = String(err)
  }
  await $.store.set('lastStart', { at: await $.clock.now(), isSessionStart, commandError }).catch(() => undefined)
  if (isSessionStart) {
    const picked = await loadPrefs($)
    await update($, prefs, () => picked)
  }
  await applyPlacement($, (await read($, prefs)).placement).catch(() => undefined)
  void refresh($)
  $.clock.every(refreshMs, () => void refresh($))
  $.clock.every(TICK_MS, () => {
    $.ui.invalidate('ui.render')
    void updateStatus($)
    const columns = JSON.stringify(seenColumns)
    if (columns !== savedColumns) {
      savedColumns = columns
      void $.store.set('columns', seenColumns).catch(() => undefined)
    }
  })
}

export const register: Register = (on, options) => {
  refreshMs = positive(options.refreshSeconds, 120) * 1000
  cacheTtlMs = positive(options.cacheTtlMinutes, 60) * 60_000
  priceMultiplier = positive(options.priceMultiplier, 1)
  configPrefs = {
    style: isStyle(options.style) ? (options.style as Style) : 'classic',
    placement: isPlacement(options.placement) ? (options.placement as Placement) : 'above',
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (e.isInteractive || e.surface !== null) await ensureStarted($, true)
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    await ensureStarted($, false)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      const endedAt = await $.clock.now()
      const model = e.usage?.model ?? (await $.session.model())
      const turn: LastTurn = { endedAt, model, durationMs: e.durationMs }
      await update($, lastTurn, () => turn)
      await ensureStarted($, false)
      await updateStatus($)
    }
    return result
  })

  on('command.run', { command: 'cpa-band' }, async ($, e) => {
    const [verb = '', word = ''] = e.args.trim().split(/\s+/)
    if (verb === 'style' || verb === '样式') {
      const style = pick(STYLES, word)
      if (!style) return { text: `没有这个样式：${word}\n${help(await read($, prefs))}` }
      await setPrefs($, { style })
      return { text: `CPA 横条样式已切换为 ${style}` }
    }
    if (verb === 'place' || verb === '位置') {
      const placement = pick(PLACEMENTS, word)
      if (!placement) return { text: `没有这个位置：${word}\n${help(await read($, prefs))}` }
      await setPrefs($, { placement })
      return { text: `CPA 横条已移到 ${placement}` }
    }
    if (verb === 'refresh' || verb === '刷新') {
      await refresh($)
      return { text: 'CPA 数据已刷新' }
    }
    return { text: help(await read($, prefs)) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const picked = await read($, prefs)
    if (picked.placement !== 'above') return next(e)

    const v = await gather($, e.surface)
    seenColumns[`above-${e.surface}`] = e.props.bodyColumns
    return render(elements($, e), { ...v, columns: e.props.bodyColumns }, actions($))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const v = await gather($, e.surface)
    const els = elements($, e)
    // Compared as a string: an engine older than widgets types the seat without it.
    const isWidgetSeat = (e.props.placement as string) === 'widget'
    seenColumns[`pane-${e.props.placement}-${e.surface}`] = e.props.bodyColumns
    if (isWidgetSeat || v.prefs.placement === 'widget') {
      return glance(els, { ...v, columns: e.props.bodyColumns, canFold: false }, actions($), !isWidgetSeat)
    }
    return render(els, { ...v, columns: e.props.bodyColumns }, actions($))
  })

  // The desktop's right-click menu: switch placement or style from anywhere, so the
  // status line (which has no buttons) is never a dead end.
  // A RegExp matcher: an engine that predates the menu never raises it, and its types lack the name.
  on('ui.render', { component: /^ContextMenu$/ }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, prefs)
    const placeRows = PLACEMENTS.filter(p => p.value !== current.placement).map(p => (
      <Button key={`cpa-place-${p.value}`} onPress={() => void setPrefs($, { placement: p.value })}>
        CPA 横条移到{p.label}
        <Text dimColor>当前：{PLACEMENTS.find(x => x.value === current.placement)?.label}</Text>
      </Button>
    ))
    const styleRows = STYLES.filter(st => st.value !== current.style).map(st => (
      <Button key={`cpa-style-${st.value}`} onPress={() => void setPrefs($, { style: st.value })}>
        CPA 横条样式：{st.label}
      </Button>
    ))
    return <Box>{[...placeRows, ...styleRows]}</Box>
  })
}
