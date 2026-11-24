// The four styles and the widget, drawn from a plain view of the data: no `$` here,
// presses go through `Actions`. Every layout reads `columns` and has a wide, a mid and
// a narrow form, so the band, a docked pane and a small seat each get one that fits.
import type {
  BoxProps, ButtonProps, ElementConstructor, RenderChildren, RenderSurface, SelectProps, SvgProps, TextProps,
} from 'claude-code'

import type { CpaAccount, CpaSnapshot, CpaWindow, Prefs } from '../types'
import {
  compact, duration, errorText, percent, period, PLACEMENTS, resetIn, severity, STYLES, textBar, usd,
} from './format'
import { capsuleSvg, cardsSvg, dashboardSvg, glanceSvg } from './svg'
import type { Drawing, Metric, Panel } from './svg'

export type Els = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Select?: ElementConstructor<SelectProps>
  Svg?: ElementConstructor<SvgProps>
}

export type View = {
  surface: RenderSurface
  snapshot: CpaSnapshot | null
  isLoading: boolean
  isFolded: boolean
  isSettingsOpen: boolean
  prefs: Prefs
  now: number
  model: string
  ctx: { tokens?: number; window: number; percent?: number }
  cost: number | null
  cacheLeft: number | null
  turnMs: number | null
  // Cells across the site the drawing goes in: the band's or the pane's body.
  columns: number
  // Draw the fold button: the band and the pane can fold, the widget cannot.
  canFold: boolean
}

export type Actions = {
  refresh: () => void
  toggleFold: () => void
  toggleSettings: () => void
  setStyle: (value: string) => void
  setPlacement: (value: string) => void
}

type Width = 'wide' | 'mid' | 'narrow'

function width(v: View): Width {
  if (v.columns >= 100) return 'wide'
  if (v.columns >= 56) return 'mid'
  return 'narrow'
}

const isStale = (a: CpaAccount) => !a.enabled || a.stale

function accountsOf(v: View): readonly CpaAccount[] {
  const s = v.snapshot
  return s && !s.error && !s.quotaError ? (s.quota?.accounts ?? []) : []
}

function cacheText(v: View): { text: string; color: string } | null {
  if (v.cacheLeft === null) return null
  return v.cacheLeft > 0
    ? { text: `缓存 ${Math.ceil(v.cacheLeft / 60_000)}m 内有效`, color: 'success' }
    : { text: '缓存已过期', color: 'inactive' }
}

function updated(v: View): string {
  if (v.isLoading) return '刷新中…'
  return v.snapshot ? `${duration(v.now - v.snapshot.fetchedAt)}前更新` : ''
}

// A level bar: Boxes the surface paints, fill and a lighter track of the same hue;
// block characters on the terminal.
function meter(els: Els, v: View, remaining: number | null, stale: boolean, cells: number) {
  const { Box, Svg, Text } = els
  const sev = severity(remaining, stale)
  if (v.surface === 'terminal') {
    return <Text color={sev.term}>{textBar(remaining, cells)}</Text>
  }
  if (Svg) return drawing(Svg, capsuleSvg(remaining, stale, cells * PX_PER_CELL))
  const share = remaining === null ? 0 : Math.max(0, Math.min(100, remaining)) / 100
  const filled = Math.round(cells * share)
  return (
    <Box flexDirection="row" width={cells} height={1} backgroundColor={sev.track}>
      {filled > 0 ? <Box width={filled} height={1} backgroundColor={sev.fill} /> : ''}
    </Box>
  )
}

// Pixels a cell stands for where a drawing is sized from the site's columns.
const PX_PER_CELL = 8

function drawing(Svg: ElementConstructor<SvgProps>, d: Drawing) {
  return <Svg source={d.source} width={d.width} height={d.height} alt={d.alt} />
}

// The width a full-width drawing takes: the site's columns in pixels, within reason.
function pixels(v: View): number {
  return Math.max(240, Math.min(1200, v.columns * PX_PER_CELL))
}

// A cost as a drawing shows it: ≈ where it is an estimate, the partial note goes under it.
function money(t: { cost: number | null; approx: boolean }): string {
  return t.cost === null ? '?' : `${t.approx ? '≈' : ''}$${t.cost.toFixed(2)}`
}

// The plain model the SVG drawings take.
function panelOf(v: View): Panel {
  const s = v.snapshot
  const hour = s ? period(s, '1h') : undefined
  const week = s ? period(s, '7d') : undefined
  const metrics: Metric[] = []
  if (s && !s.error && !s.usageError) {
    if (hour) metrics.push({ label: '近 1 小时', value: money(hour), sub: [`${hour.requests ?? '?'} 次 · ${compact(hour.tokens)}`, hour.partial ? '部分计价' : ''].filter(Boolean).join(' · ') })
    if (week) metrics.push({ label: '近 7 天', value: money(week), sub: `缓存命中 ${week.cachePct === null ? '?' : `${week.cachePct.toFixed(1)}%`}` })
  }
  metrics.push({ label: '上下文', value: v.ctx.percent === undefined ? '?' : `${v.ctx.percent}%`, sub: `${compact(v.ctx.tokens)} / ${compact(v.ctx.window)}` })
  metrics.push({ label: v.model, value: v.cost === null ? '—' : `≈$${v.cost.toFixed(2)}`, sub: cacheText(v)?.text })
  const notice = !s ? 'CPA 查询中…' : s.error ? errorText(s.error) : s.quotaError ? errorText(s.quotaError) : s.usageError ? `用量：${errorText(s.usageError)}` : undefined
  return { metrics, accounts: accountsOf(v), notice, now: v.now }
}

function sessionMetrics(v: View): Metric[] {
  const cache = cacheText(v)
  return [
    { label: '模型', value: v.model },
    { label: '上下文', value: `${v.ctx.percent ?? '?'}% · ${compact(v.ctx.tokens)}` },
    { label: '本会话', value: v.cost === null ? '—' : `≈$${v.cost.toFixed(4)}` },
    ...(cache ? [{ label: '缓存', value: cache.text.replace(/^缓存 /, '') }] : []),
    ...(v.turnMs === null ? [] : [{ label: '上轮耗时', value: duration(v.turnMs) }]),
  ]
}

// A header row: the title and when it was read on the left, the controls on the right.
function header(els: Els, v: View, a: Actions) {
  const { Box, Button, Text } = els
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      <Text>
        <Text weight="semibold">CPA 额度</Text>
        <Text dimColor size="caption">  {updated(v)}</Text>
      </Text>
      <Box flexDirection="row" gap={1}>
        <Button key="refresh" label="刷新" dimColor onPress={a.refresh} />
        {v.canFold ? <Button key="fold" label={v.isFolded ? '展开' : '收起'} dimColor onPress={a.toggleFold} /> : ''}
        <Button key="settings" label={v.isSettingsOpen ? '完成' : '设置'} dimColor onPress={a.toggleSettings} />
      </Box>
    </Box>
  )
}

// One window of one account: name, bar, the figure in text ink, and the word when it matters.
function windowRow(els: Els, v: View, account: CpaAccount, w: CpaWindow, cells: number, showReset: boolean) {
  const { Box, Text } = els
  const stale = isStale(account)
  const sev = severity(w.remaining, stale)
  const reset = resetIn(w, v.now)
  return (
    <Box key={`${account.label}-${w.name}`} flexDirection="row" gap={1} alignItems="center">
      <Text dimColor>{w.name.padEnd(2)}</Text>
      {meter(els, v, w.remaining, stale, cells)}
      <Text weight="semibold" tabular>{percent(w.remaining).padStart(4)}</Text>
      {sev.tag ? <Text color={sev.term}>{sev.tag}</Text> : ''}
      {showReset && Number.isFinite(reset) ? <Text dimColor>{duration(reset)}后重置</Text> : ''}
    </Box>
  )
}

// The meter list: a row per account. Wide, its windows side by side; otherwise each
// window drops under the account's name.
function meterList(els: Els, v: View, cells: number) {
  const { Box, Text } = els
  const s = v.snapshot
  if (s?.quotaError) return <Text color="error">额度：{errorText(s.quotaError)}</Text>
  const isRow = width(v) === 'wide'
  return (
    <Box flexDirection="column" gap={isRow ? 0 : 1}>
      {accountsOf(v).map(account => (
        <Box key={account.label} flexDirection={isRow ? 'row' : 'column'} gap={isRow ? 3 : 0}>
          <Box width={isRow ? 4 : undefined}>
            <Text weight="semibold">{account.label}</Text>
          </Box>
          {account.windows.map(w => windowRow(els, v, account, w, cells, width(v) !== 'narrow'))}
        </Box>
      ))}
    </Box>
  )
}

// A stat tile: a quiet label, the value, an optional line under it.
function tile(els: Els, key: string, label: string, value: string, sub?: string, minWidth = 16) {
  const { Box, Text } = els
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} minWidth={minWidth} flexGrow={1}>
      <Text dimColor size="caption">{label}</Text>
      <Text weight="semibold" size="heading">{value}</Text>
      {sub ? <Text dimColor size="caption">{sub}</Text> : ''}
    </Box>
  )
}

function tiles(els: Els, v: View, minWidth: number): RenderChildren[] {
  const s = v.snapshot
  const hour = s ? period(s, '1h') : undefined
  const week = s ? period(s, '7d') : undefined
  const cache = cacheText(v)
  const out: RenderChildren[] = []
  if (s && !s.error && !s.usageError) {
    if (hour) out.push(tile(els, 'hour', '近 1 小时', usd(hour), `${hour.requests ?? '?'} 次 · ${compact(hour.tokens)}`, minWidth))
    if (week) out.push(tile(els, 'week', '近 7 天', usd(week), `缓存命中 ${week.cachePct === null ? '?' : `${week.cachePct.toFixed(1)}%`}`, minWidth))
  }
  out.push(tile(els, 'ctx', '上下文', v.ctx.percent === undefined ? '?' : `${v.ctx.percent}%`, `${compact(v.ctx.tokens)} / ${compact(v.ctx.window)}`, minWidth))
  out.push(tile(els, 'session', v.model, v.cost === null ? '—' : `≈$${v.cost.toFixed(2)}`, cache?.text, minWidth))
  return out
}

function controls(els: Els, v: View, a: Actions) {
  const { Box, Button, Text } = els
  return (
    <Box flexDirection="row" gap={1} alignItems="center">
      <Text dimColor>{updated(v)}</Text>
      <Button key="refresh" label="刷新" dimColor onPress={a.refresh} />
      {v.canFold ? <Button key="fold" label={v.isFolded ? '展开' : '收起'} dimColor onPress={a.toggleFold} /> : ''}
      <Button key="settings" label={v.isSettingsOpen ? '完成' : '设置'} dimColor onPress={a.toggleSettings} />
    </Box>
  )
}

// Two pickers, or a row of buttons each where the surface has no Select.
function settings(els: Els, v: View, a: Actions) {
  const { Box, Button, Select, Text } = els
  const choices = (name: string, list: readonly { value: string; label: string }[], current: string, onPick: (value: string) => void) =>
    Select ? (
      <Select key={name} label={`${name} `} options={list} value={current} onSelect={onPick} />
    ) : (
      <Box key={name} flexDirection="row" flexWrap="wrap" gap={1}>
        <Text dimColor>{name}</Text>
        {list.map(item => (
          <Button
            key={`${name}-${item.value}`}
            label={item.label}
            variant={item.value === current ? 'primary' : undefined}
            dimColor={item.value !== current}
            onPress={() => onPick(item.value)}
          />
        ))}
      </Box>
    )
  return (
    <Box flexDirection={width(v) === 'narrow' ? 'column' : 'row'} flexWrap="wrap" gap={2}>
      <Text dimColor>CPA 横条设置</Text>
      {choices('样式', STYLES, v.prefs.style, a.setStyle)}
      {choices('位置', PLACEMENTS, v.prefs.placement, a.setPlacement)}
    </Box>
  )
}

// The CPA side's failure, if any: the whole query has none to show.
function cpaProblem(els: Els, v: View) {
  const { Text } = els
  if (!v.snapshot) return <Text dimColor>CPA 查询中…</Text>
  if (v.snapshot.error) return <Text color="error">CPA：{errorText(v.snapshot.error)}</Text>
  return null
}

function usageLine(els: Els, v: View) {
  const { Text } = els
  const s = v.snapshot
  if (!s) return ''
  if (s.usageError) return <Text color="error">用量：{errorText(s.usageError)}</Text>
  const hour = period(s, '1h')
  const week = period(s, '7d')
  return (
    <Text>
      {hour ? <Text><Text dimColor>1h </Text>{usd(hour)} <Text dimColor>{hour.requests ?? '?'}次 {compact(hour.tokens)}</Text>   </Text> : ''}
      {week ? <Text><Text dimColor>7d </Text>{usd(week)} <Text dimColor>缓存 {week.cachePct === null ? '?' : `${week.cachePct.toFixed(1)}%`}</Text></Text> : ''}
    </Text>
  )
}

function sessionLine(els: Els, v: View) {
  const { Text } = els
  const cache = cacheText(v)
  const isNarrow = width(v) === 'narrow'
  return (
    <Text>
      <Text>{v.model}</Text>
      <Text dimColor>  上下文 </Text>
      <Text>{isNarrow ? `${v.ctx.percent ?? '?'}%` : `${compact(v.ctx.tokens)}/${compact(v.ctx.window)} (${v.ctx.percent ?? '?'}%)`}</Text>
      {v.cost === null ? '' : <Text><Text dimColor>  会话 </Text>≈${v.cost.toFixed(isNarrow ? 2 : 4)}</Text>}
      {cache ? <Text color={cache.color}>  {cache.text}</Text> : ''}
      {v.turnMs === null || isNarrow ? '' : <Text dimColor>  上轮 {duration(v.turnMs)}</Text>}
    </Text>
  )
}

function heading(els: Els, title: string) {
  const { Text } = els
  return <Text color="claude" weight="semibold">{title}</Text>
}

// 经典: text lines with a meter list; no frames.
function classic(els: Els, v: View, a: Actions) {
  const { Box } = els
  const w = width(v)
  return (
    <Box flexDirection="column">
      {cpaProblem(els, v) ?? (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" gap={2}>
            {heading(els, 'CPA')}
            {usageLine(els, v)}
          </Box>
          {meterList(els, v, w === 'narrow' ? 8 : 12)}
        </Box>
      )}
      <Box flexDirection="row" flexWrap="wrap" gap={2}>
        {heading(els, '会话')}
        {sessionLine(els, v)}
      </Box>
      {controls(els, v, a)}
    </Box>
  )
}

// 紧凑: one wrapping line. Also what any style folds to.
function compactStyle(els: Els, v: View, a: Actions) {
  const { Box, Text } = els
  const s = v.snapshot
  const hour = s ? period(s, '1h') : undefined
  const cache = cacheText(v)
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
      {heading(els, 'CPA')}
      {cpaProblem(els, v) ?? ''}
      {hour && !s?.usageError ? <Text><Text dimColor>1h </Text>{usd(hour)}</Text> : ''}
      {accountsOf(v).map(account => (
        <Text key={account.label}>
          <Text weight="semibold">{account.label} </Text>
          {account.windows.map(w => {
            const sev = severity(w.remaining, isStale(account))
            return (
              <Text key={w.name}>
                <Text color={sev.term}>●</Text>
                <Text dimColor>{w.name} </Text>
                {percent(w.remaining)}
                {sev.tag ? <Text color={sev.term}>{sev.tag}</Text> : ''}{' '}
              </Text>
            )
          })}
        </Text>
      ))}
      <Text>
        <Text dimColor>│ </Text>{v.model}
        <Text dimColor> 上下文 </Text>{v.ctx.percent ?? '?'}%
      </Text>
      {cache ? <Text color={cache.color}>{cache.text}</Text> : ''}
      {controls(els, v, a)}
    </Box>
  )
}

function card(els: Els, key: string, title: string, children: RenderChildren[], grow = 0) {
  const { Box, Text } = els
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} flexGrow={grow} minWidth={24}>
      <Text dimColor weight="semibold">{title}</Text>
      {children}
    </Box>
  )
}

// 卡片: one framed card per account, one for usage, one for the session; side by side
// where wide, two up in the middle, stacked when narrow.
function cards(els: Els, v: View, a: Actions) {
  const { Box, Svg, Text } = els
  if (Svg) {
    const panel = panelOf(v)
    return (
      <Box flexDirection="column" gap={1}>
        {header(els, v, a)}
        {drawing(Svg, cardsSvg({ ...panel, metrics: panel.metrics.slice(0, 2) }, sessionMetrics(v), pixels(v)))}
      </Box>
    )
  }
  const s = v.snapshot
  const w = width(v)
  const cells = w === 'narrow' ? 10 : 12
  const hour = s ? period(s, '1h') : undefined
  const week = s ? period(s, '7d') : undefined
  const cache = cacheText(v)
  const usageCard = card(els, 'usage', 'CPA 用量', cpaProblem(els, v) ? [cpaProblem(els, v)] : s?.usageError ? [
    <Text color="error">{errorText(s.usageError)}</Text>,
  ] : [
    hour ? <Text><Text dimColor>1h  </Text><Text weight="semibold">{usd(hour)}</Text> <Text dimColor>{hour.requests ?? '?'}次 {compact(hour.tokens)}</Text></Text> : '',
    week ? <Text><Text dimColor>7d  </Text><Text weight="semibold">{usd(week)}</Text></Text> : '',
    week ? <Text><Text dimColor>缓存命中 </Text>{week.cachePct === null ? '?' : `${week.cachePct.toFixed(1)}%`}</Text> : '',
  ])
  const accountCards = s?.quotaError
    ? [card(els, 'quota', '额度', [<Text color="error">{errorText(s.quotaError)}</Text>])]
    : accountsOf(v).map(account => card(els, account.label,
      `${account.label}${isStale(account) ? (account.enabled ? ' · 旧值' : ' · 已禁用') : ''}`,
      account.windows.map(win => windowRow(els, v, account, win, cells, true))))
  const sessionCard = card(els, 'session', '会话', [
    <Text weight="semibold">{v.model}</Text>,
    <Box flexDirection="row" gap={1}>
      <Text dimColor>上下文</Text>
      {meter(els, v, v.ctx.percent === undefined ? null : 100 - v.ctx.percent, false, cells)}
      <Text>{v.ctx.percent ?? '?'}%</Text>
    </Box>,
    <Text>
      {v.cost === null ? '' : <Text>≈${v.cost.toFixed(4)}  </Text>}
      {v.turnMs === null ? '' : <Text dimColor>上轮 {duration(v.turnMs)}</Text>}
    </Text>,
    cache ? <Text color={cache.color}>{cache.text}</Text> : '',
  ])
  return (
    <Box flexDirection="column" gap={0}>
      <Box flexDirection={w === 'narrow' ? 'column' : 'row'} flexWrap="wrap" gap={1}>
        {usageCard}
        {accountCards}
        {sessionCard}
      </Box>
      {controls(els, v, a)}
    </Box>
  )
}

// 仪表盘: a row of stat tiles over a full-width meter list. Wide, the list and the tiles
// sit side by side; mid, tiles two up above the list; narrow, all stacked.
function dashboard(els: Els, v: View, a: Actions) {
  const { Box, Svg } = els
  if (Svg) {
    return (
      <Box flexDirection="column" gap={1}>
        {header(els, v, a)}
        {drawing(Svg, dashboardSvg(panelOf(v), pixels(v)))}
      </Box>
    )
  }
  const w = width(v)
  const problem = cpaProblem(els, v)
  const quota = card(els, 'quota', '账号额度', [problem ?? meterList(els, v, w === 'wide' ? 14 : w === 'mid' ? 16 : 10)], 1)
  const tileBox = (
    <Box key="tiles" flexDirection="row" flexWrap="wrap" gap={1} flexGrow={1}>
      {tiles(els, v, w === 'narrow' ? 14 : 18)}
    </Box>
  )
  return (
    <Box flexDirection="column" gap={0}>
      {w === 'wide' ? (
        <Box flexDirection="row" gap={1}>
          {quota}
          {tileBox}
        </Box>
      ) : (
        <Box flexDirection="column" gap={1}>
          {tileBox}
          {quota}
        </Box>
      )}
      {controls(els, v, a)}
    </Box>
  )
}

// The small seat: a meter list at a glance and the cache; one press back to the full pane
// where the seat takes presses.
export function glance(els: Els, v: View, a: Actions, canPress: boolean) {
  const { Box, Button, Svg, Text } = els
  const s = v.snapshot
  const hour = s ? period(s, '1h') : undefined
  const cache = cacheText(v)
  if (Svg) {
    const footer = [hour && !s?.usageError ? `1h ${money(hour)}` : '', cache?.text ?? ''].filter(Boolean).join('  ·  ')
    return (
      <Box flexDirection="column" gap={1}>
        {drawing(Svg, glanceSvg(panelOf(v), Math.max(220, Math.min(360, pixels(v))), footer))}
        {canPress ? <Button key="expand" label="展开为面板" dimColor onPress={() => a.setPlacement('pane')} /> : ''}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {cpaProblem(els, v) ?? ''}
      {accountsOf(v).map(account => (
        <Box key={account.label} flexDirection="column">
          <Text weight="semibold" size="caption">{account.label}</Text>
          {account.windows.map(w => windowRow(els, v, account, w, 8, false))}
        </Box>
      ))}
      <Text size="caption">
        {hour && !s?.usageError ? <Text><Text dimColor>1h </Text>{usd(hour)}  </Text> : ''}
        {cache ? <Text color={cache.color}>{cache.text}</Text> : ''}
      </Text>
      {canPress ? <Button key="expand" label="展开为面板" dimColor onPress={() => a.setPlacement('pane')} /> : ''}
    </Box>
  )
}

export function render(els: Els, v: View, a: Actions) {
  const { Box } = els
  const body = v.isFolded
    ? compactStyle(els, v, a)
    : v.prefs.style === 'compact'
      ? compactStyle(els, v, a)
      : v.prefs.style === 'card'
        ? cards(els, v, a)
        : v.prefs.style === 'gauge'
          ? dashboard(els, v, a)
          : classic(els, v, a)
  return (
    <Box flexDirection="column">
      {body}
      {v.isSettingsOpen ? settings(els, v, a) : ''}
    </Box>
  )
}
