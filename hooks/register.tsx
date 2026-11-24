import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CpaAccount, CpaSnapshot, CpaTotals, LastTurn } from '../types'

const cpa = atom({ plugin: 'cpa-band', key: 'cpa' } as const, null)
const isLoading = atom({ plugin: 'cpa-band', key: 'isLoading' } as const, false)
const lastTurn = atom({ plugin: 'cpa-band', key: 'lastTurn' } as const, null)
const isFolded = atom({ plugin: 'cpa-band', key: 'isFolded' } as const, false)

const TICK_MS = 15_000
const BAR_CELLS = 10

const ERRORS: Record<string, string> = {
  'no-config': '未找到 ~/.cpa/query.json：先运行一次 CPA 查询并保存配置',
  'bad-config': '~/.cpa/query.json 缺少 base_url、proxy_url 或 api_key',
  'run-failed': 'PowerShell 查询脚本运行失败',
  'http-0': '连接失败：检查代理是否开启',
  'http-401': 'Key 无效或已撤销',
  'http-404': '入口未配置该接口',
  'http-429': '查询过于频繁，调大刷新间隔',
}

function errorText(code: string): string {
  return ERRORS[code] ?? code.replace(/^http-/, 'HTTP ')
}

function positive(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

function usd(t: CpaTotals): string {
  if (t.cost === null) return '?'
  return `${t.partial ? '*' : ''}${t.approx ? '~' : ''}$${t.cost.toFixed(2)}`
}

function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d${Math.floor((s % 86_400) / 3600)}h`
  if (s >= 3600) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m`
  return `${s}s`
}

function tone(remaining: number | null, isStale: boolean): string {
  if (isStale || remaining === null) return 'inactive'
  if (remaining > 50) return 'success'
  if (remaining > 20) return 'warning'
  return 'error'
}

function bar(remaining: number | null): string {
  const filled = remaining === null ? 0 : Math.round((BAR_CELLS * remaining) / 100)
  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled)
}

let isRunning = false

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
}

export const register: Register = (on, options) => {
  const refreshMs = positive(options.refreshSeconds, 120) * 1000
  const cacheTtlMs = positive(options.cacheTtlMinutes, 60) * 60_000
  const priceMultiplier = positive(options.priceMultiplier, 1)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (e.isInteractive) {
      void refresh($)
      $.clock.every(refreshMs, () => void refresh($))
      $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    }
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      const endedAt = await $.clock.now()
      const model = e.usage?.model ?? (await $.session.model())
      const turn: LastTurn = { endedAt, model, durationMs: e.durationMs }
      await update($, lastTurn, () => turn)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const [snapshot, loading, turn, folded, usage, now] = await Promise.all([
      read($, cpa), read($, isLoading), read($, lastTurn), read($, isFolded),
      $.session.usage(), $.clock.now(),
    ])
    const model = turn?.model ?? (await $.session.model())

    const percent = (remaining: number | null) => (remaining === null ? '?' : `${remaining.toFixed(0)}%`)

    // Folded: each account's windows as bare percentages, on the session row.
    const quotaInline = (accounts: CpaAccount[]) =>
      accounts.map(account => (
        <Text key={account.label}>
          <Text dimColor>{account.label} </Text>
          {account.windows.map((w, i) => (
            <Text key={w.name} color={tone(w.remaining, !account.enabled || account.stale)}>
              {i > 0 ? '/' : ''}{percent(w.remaining)}
            </Text>
          ))}
          {'  '}
        </Text>
      ))

    // Unfolded: one row per account, its windows side by side in fixed-width cells.
    const accountRows = (accounts: CpaAccount[]) =>
      accounts.map(account => {
        const stale = !account.enabled || account.stale
        return (
          <Box key={account.label} flexDirection="row">
            <Box width={5}>
              <Text bold>{account.label}</Text>
            </Box>
            {account.windows.map(w => {
              const reset = w.resetsAt && w.remaining !== 100 ? Date.parse(w.resetsAt) - now : NaN
              return (
                <Box key={w.name} width={34}>
                  <Text>
                    <Text dimColor>{w.name} </Text>
                    <Text color={tone(w.remaining, stale)} tabular>
                      {bar(w.remaining)} {percent(w.remaining).padStart(4)}
                    </Text>
                    {Number.isFinite(reset) ? <Text dimColor> {duration(reset)}后重置</Text> : ''}
                  </Text>
                </Box>
              )
            })}
            {stale ? <Text dimColor>{account.enabled ? '旧值' : '已禁用'}</Text> : ''}
          </Box>
        )
      })

    const cpaRows = () => {
      if (!snapshot) {
        return <Text dimColor>CPA 查询中…</Text>
      }
      if (snapshot.error) {
        return <Text color="error">CPA：{errorText(snapshot.error)}</Text>
      }
      const windows = snapshot.usage?.windows ?? []
      const hour = windows.find(w => w.period === '1h')
      const week = windows.find(w => w.period === '7d')
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap">
            <Text color="claude" bold>CPA  </Text>
            {snapshot.usageError ? (
              <Text color="error">用量：{errorText(snapshot.usageError)}  </Text>
            ) : (
              <Text>
                {hour ? <Text>1h {hour.requests ?? '?'}次 {compact(hour.tokens)} <Text color="warning">{usd(hour)}</Text>   </Text> : ''}
                {week ? <Text>7d <Text color="warning">{usd(week)}</Text> 缓存 {week.cachePct === null ? '?' : `${week.cachePct.toFixed(1)}%`}   </Text> : ''}
              </Text>
            )}
            <Text dimColor>{loading ? '刷新中…' : `${duration(now - snapshot.fetchedAt)}前更新`}</Text>
          </Box>
          {snapshot.quotaError ? (
            <Text color="error">额度：{errorText(snapshot.quotaError)}</Text>
          ) : (
            accountRows(snapshot.quota?.accounts ?? [])
          )}
        </Box>
      )
    }

    const ctx = usage.context
    const cost = usage.cost ? usage.cost.usd * priceMultiplier : null
    const cacheLeft = turn ? cacheTtlMs - (now - turn.endedAt) : null

    const sessionRow = (
      <Box flexDirection="row" flexWrap="wrap">
        <Text color="claude" bold>会话  </Text>
        <Text>{model}  </Text>
        <Text>
          上下文 {compact(ctx.tokens)}/{compact(ctx.window)}
          {ctx.percent === undefined ? '' : ` (${ctx.percent}%)`}{'  '}
        </Text>
        {cost === null ? '' : <Text color="warning">≈${cost.toFixed(4)}  </Text>}
        {cacheLeft === null ? (
          ''
        ) : cacheLeft > 0 ? (
          <Text color="success">缓存 {Math.ceil(cacheLeft / 60_000)}m 内有效  </Text>
        ) : (
          <Text color="inactive">缓存已过期  </Text>
        )}
        {turn ? <Text dimColor>上轮 {duration(turn.durationMs)}  </Text> : ''}
        {folded && snapshot?.quota ? quotaInline(snapshot.quota.accounts) : ''}
        <Button key="refresh" label="刷新" dimColor onPress={() => refresh($)} />
        <Button
          key="fold"
          label={folded ? '展开' : '收起'}
          dimColor
          onPress={() => update($, isFolded, v => !v)}
        />
      </Box>
    )

    return (
      <Box flexDirection="column">
        {folded ? '' : cpaRows()}
        {sessionRow}
      </Box>
    )
  })
}
