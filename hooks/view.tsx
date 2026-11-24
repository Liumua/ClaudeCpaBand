// The four styles, drawn from a plain view of the data: no `$` here, presses go through `Actions`.
import type {
  BoxProps, ButtonProps, ElementConstructor, RenderChildren, RenderSurface, SelectProps, SvgProps, TextProps,
} from 'claude-code'

import type { CpaAccount, CpaSnapshot, Prefs } from '../types'
import {
  compact, duration, errorText, gaugeSvg, percent, period, PLACEMENTS, resetIn, STYLES, statusLine, textBar, tone, usd,
} from './format'

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
  // Sections stack in a column (a narrow pane) instead of sitting in a row.
  isNarrow: boolean
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

const isStale = (a: CpaAccount) => !a.enabled || a.stale

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

// A level bar: Boxes where the surface paints them, block characters on the terminal.
function meter(els: Els, v: View, remaining: number | null, color: string, cells: number) {
  const { Box, Text } = els
  if (v.surface === 'terminal') {
    return <Text color={color}>{textBar(remaining, cells)}</Text>
  }
  const filled = remaining === null ? 0 : Math.round((cells * Math.max(0, Math.min(100, remaining))) / 100)
  return (
    <Box flexDirection="row" width={cells} height={1}>
      {filled > 0 ? <Box width={filled} height={1} backgroundColor={color} /> : ''}
      {filled < cells ? <Box width={cells - filled} height={1} backgroundColor="subtle" /> : ''}
    </Box>
  )
}

function controls(els: Els, v: View, a: Actions) {
  const { Box, Button } = els
  return (
    <Box flexDirection="row" gap={1}>
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
      <Box key={name} flexDirection="row" gap={1}>
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
    <Box flexDirection="row" flexWrap="wrap" gap={2}>
      <Text dimColor>CPA 横条设置</Text>
      {choices('样式', STYLES, v.prefs.style, a.setStyle)}
      {choices('位置', PLACEMENTS, v.prefs.placement, a.setPlacement)}
    </Box>
  )
}

// The CPA side's failure, if any: the whole query, or one of its two calls.
function cpaProblem(els: Els, v: View) {
  const { Text } = els
  if (!v.snapshot) return <Text dimColor>CPA 查询中…</Text>
  if (v.snapshot.error) return <Text color="error">CPA：{errorText(v.snapshot.error)}</Text>
  return null
}

function usageText(els: Els, v: View) {
  const { Text } = els
  const s = v.snapshot
  if (!s) return ''
  if (s.usageError) return <Text color="error">用量：{errorText(s.usageError)}  </Text>
  const hour = period(s, '1h')
  const week = period(s, '7d')
  return (
    <Text>
      {hour ? <Text>1h {hour.requests ?? '?'}次 {compact(hour.tokens)} <Text color="warning">{usd(hour)}</Text>   </Text> : ''}
      {week ? <Text>7d <Text color="warning">{usd(week)}</Text> 缓存 {week.cachePct === null ? '?' : `${week.cachePct.toFixed(1)}%`}   </Text> : ''}
    </Text>
  )
}

function sessionText(els: Els, v: View) {
  const { Text } = els
  const cache = cacheText(v)
  return (
    <Text>
      <Text>{v.model}  </Text>
      <Text>
        上下文 {compact(v.ctx.tokens)}/{compact(v.ctx.window)}
        {v.ctx.percent === undefined ? '' : ` (${v.ctx.percent}%)`}{'  '}
      </Text>
      {v.cost === null ? '' : <Text color="warning">≈${v.cost.toFixed(4)}  </Text>}
      {cache ? <Text color={cache.color}>{cache.text}  </Text> : ''}
      {v.turnMs === null ? '' : <Text dimColor>上轮 {duration(v.turnMs)}  </Text>}
    </Text>
  )
}

// Each account's windows as coloured percentages, for the one-line forms.
function quotaInline(els: Els, accounts: readonly CpaAccount[]) {
  const { Text } = els
  return accounts.map(account => (
    <Text>
      <Text dimColor>{account.label} </Text>
      {account.windows.map(w => (
        <Text>
          <Text dimColor>{w.name} </Text>
          <Text color={tone(w.remaining, isStale(account))} bold>{percent(w.remaining)} </Text>
        </Text>
      ))}
      {' '}
    </Text>
  ))
}

// 经典: a usage line, one line per account with text bars, then the session line.
function classic(els: Els, v: View, a: Actions) {
  const { Box, Text } = els
  const problem = cpaProblem(els, v)
  const s = v.snapshot
  return (
    <Box flexDirection="column">
      {problem ?? (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap">
            <Text color="claude" bold>CPA  </Text>
            {usageText(els, v)}
            <Text dimColor>{updated(v)}</Text>
          </Box>
          {s?.quotaError ? (
            <Text color="error">额度：{errorText(s.quotaError)}</Text>
          ) : (
            (s?.quota?.accounts ?? []).map(account => (
              <Box key={account.label} flexDirection="row" flexWrap="wrap">
                <Box width={5}>
                  <Text bold>{account.label}</Text>
                </Box>
                {account.windows.map(w => {
                  const reset = resetIn(w, v.now)
                  return (
                    <Box key={w.name} width={v.isNarrow ? undefined : 34} flexDirection="row" gap={1}>
                      <Text dimColor>{w.name}</Text>
                      {meter(els, v, w.remaining, tone(w.remaining, isStale(account)), 10)}
                      <Text color={tone(w.remaining, isStale(account))}>{percent(w.remaining).padStart(4)}</Text>
                      {Number.isFinite(reset) ? <Text dimColor>{duration(reset)}后重置</Text> : ''}
                    </Box>
                  )
                })}
              </Box>
            ))
          )}
        </Box>
      )}
      <Box flexDirection="row" flexWrap="wrap">
        <Text color="claude" bold>会话  </Text>
        {sessionText(els, v)}
        {controls(els, v, a)}
      </Box>
    </Box>
  )
}

// 紧凑: everything on one wrapping line. Also what any style folds to.
function compactStyle(els: Els, v: View, a: Actions) {
  const { Box, Text } = els
  const problem = cpaProblem(els, v)
  const s = v.snapshot
  const hour = s ? period(s, '1h') : undefined
  const cache = cacheText(v)
  return (
    <Box flexDirection="row" flexWrap="wrap">
      <Text color="claude" bold>CPA </Text>
      {problem ?? (
        <Text>
          {hour ? <Text>1h <Text color="warning">{usd(hour)}</Text><Text dimColor> │ </Text></Text> : ''}
          {s?.quotaError ? <Text color="error">额度：{errorText(s.quotaError)} </Text> : quotaInline(els, s?.quota?.accounts ?? [])}
        </Text>
      )}
      <Text dimColor>│ </Text>
      <Text>{v.model} </Text>
      <Text dimColor>· </Text>
      <Text>上下文 {v.ctx.percent ?? '?'}% </Text>
      {v.cost === null ? '' : <Text><Text dimColor>· </Text><Text color="warning">≈${v.cost.toFixed(2)} </Text></Text>}
      {cache ? <Text><Text dimColor>· </Text><Text color={cache.color}>{cache.text} </Text></Text> : ''}
      {controls(els, v, a)}
    </Box>
  )
}

function card(els: Els, title: string, children: RenderChildren[], key: string) {
  const { Box, Text } = els
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} minWidth={22}>
      <Text dimColor bold>{title}</Text>
      {children}
    </Box>
  )
}

function usageCard(els: Els, v: View) {
  const { Text } = els
  const s = v.snapshot
  if (!s) return card(els, 'CPA 用量', [<Text dimColor>查询中…</Text>], 'usage')
  if (s.usageError) return card(els, 'CPA 用量', [<Text color="error">{errorText(s.usageError)}</Text>], 'usage')
  const hour = period(s, '1h')
  const week = period(s, '7d')
  return card(els, 'CPA 用量', [
    hour ? <Text>1h  <Text color="warning" bold>{usd(hour)}</Text> <Text dimColor>{hour.requests ?? '?'}次 {compact(hour.tokens)}</Text></Text> : '',
    week ? <Text>7d  <Text color="warning" bold>{usd(week)}</Text></Text> : '',
    week ? <Text>缓存命中 <Text color="success">{week.cachePct === null ? '?' : `${week.cachePct.toFixed(1)}%`}</Text></Text> : '',
    <Text dimColor>{updated(v)}</Text>,
  ], 'usage')
}

function accountCard(els: Els, v: View, account: CpaAccount) {
  const { Box, Text } = els
  const stale = isStale(account)
  const title = `${account.label}${stale ? (account.enabled ? ' · 旧值' : ' · 已禁用') : ''}`
  return card(els, title, account.windows.map(w => {
    const reset = resetIn(w, v.now)
    const color = tone(w.remaining, stale)
    return (
      <Box key={w.name} flexDirection="row" gap={1}>
        <Text dimColor>{w.name.padEnd(2)}</Text>
        {meter(els, v, w.remaining, color, 12)}
        <Text color={color} bold>{percent(w.remaining).padStart(4)}</Text>
        {Number.isFinite(reset) ? <Text dimColor>{duration(reset)}</Text> : ''}
      </Box>
    )
  }), account.label)
}

function sessionCard(els: Els, v: View) {
  const { Box, Text } = els
  const cache = cacheText(v)
  const ctxPct = v.ctx.percent ?? null
  return card(els, '会话', [
    <Text bold>{v.model}</Text>,
    <Box flexDirection="row" gap={1}>
      <Text dimColor>上下文</Text>
      {meter(els, v, ctxPct === null ? null : 100 - ctxPct, 'suggestion', 10)}
      <Text>{compact(v.ctx.tokens)}/{compact(v.ctx.window)}</Text>
    </Box>,
    <Text>
      {v.cost === null ? '' : <Text color="warning">≈${v.cost.toFixed(4)}  </Text>}
      {v.turnMs === null ? '' : <Text dimColor>上轮 {duration(v.turnMs)}</Text>}
    </Text>,
    cache ? <Text color={cache.color}>{cache.text}</Text> : '',
  ], 'session')
}

// 卡片: framed cards side by side (stacked in a narrow pane), level bars drawn as Boxes.
function cards(els: Els, v: View, a: Actions) {
  const { Box, Text } = els
  const s = v.snapshot
  const accounts = s && !s.error && !s.quotaError ? (s.quota?.accounts ?? []) : []
  return (
    <Box flexDirection="column">
      <Box flexDirection={v.isNarrow ? 'column' : 'row'} flexWrap="wrap" gap={1}>
        {s?.error ? card(els, 'CPA', [<Text color="error">{errorText(s.error)}</Text>], 'usage') : usageCard(els, v)}
        {s?.quotaError ? card(els, '额度', [<Text color="error">{errorText(s.quotaError)}</Text>], 'quota') : ''}
        {accounts.map(account => accountCard(els, v, account))}
        {sessionCard(els, v)}
      </Box>
      {controls(els, v, a)}
    </Box>
  )
}

// 仪表: ring gauges for the accounts where the surface draws Svg; cards elsewhere.
function gauge(els: Els, v: View, a: Actions) {
  const { Box, Svg, Text } = els
  const s = v.snapshot
  const accounts = s && !s.error && !s.quotaError ? (s.quota?.accounts ?? []) : []
  if (!Svg || accounts.length === 0) return cards(els, v, a)
  const drawing = gaugeSvg(accounts, v.now)
  return (
    <Box flexDirection="column">
      <Box flexDirection={v.isNarrow ? 'column' : 'row'} flexWrap="wrap" gap={2} alignItems="center">
        <Svg
          source={drawing.source}
          width={drawing.width}
          height={drawing.height}
          alt={statusLine(s, { model: v.model, ctxPercent: v.ctx.percent, cost: v.cost, cacheLeft: v.cacheLeft })}
        />
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap">
            <Text color="claude" bold>CPA  </Text>
            {usageText(els, v)}
          </Box>
          <Box flexDirection="row" flexWrap="wrap">
            <Text color="claude" bold>会话  </Text>
            {sessionText(els, v)}
          </Box>
          <Text dimColor>{updated(v)}</Text>
        </Box>
      </Box>
      {controls(els, v, a)}
    </Box>
  )
}

// The small widget: what reads at a glance, no controls (clicks may not reach it).
export function glance(els: Els, v: View) {
  const { Box, Svg, Text } = els
  const s = v.snapshot
  const accounts = s && !s.error && !s.quotaError ? (s.quota?.accounts ?? []) : []
  const cache = cacheText(v)
  if (v.prefs.style === 'gauge' && Svg && accounts.length > 0) {
    const drawing = gaugeSvg(accounts, v.now)
    return (
      <Box flexDirection="column">
        <Svg source={drawing.source} width={drawing.width} height={drawing.height} alt="CPA 额度" />
        {cache ? <Text color={cache.color}>{cache.text}</Text> : ''}
      </Box>
    )
  }
  const hour = s ? period(s, '1h') : undefined
  return (
    <Box flexDirection="column">
      {cpaProblem(els, v) ?? ''}
      {accounts.map(account => (
        <Text>
          <Text bold>{account.label} </Text>
          {account.windows.map(w => (
            <Text>
              <Text dimColor>{w.name} </Text>
              <Text color={tone(w.remaining, isStale(account))} bold>{percent(w.remaining)} </Text>
            </Text>
          ))}
        </Text>
      ))}
      {hour ? <Text><Text dimColor>1h </Text><Text color="warning">{usd(hour)}</Text></Text> : ''}
      {cache ? <Text color={cache.color}>{cache.text}</Text> : ''}
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
          ? gauge(els, v, a)
          : classic(els, v, a)
  return (
    <Box flexDirection="column">
      {body}
      {v.isSettingsOpen ? settings(els, v, a) : ''}
    </Box>
  )
}
