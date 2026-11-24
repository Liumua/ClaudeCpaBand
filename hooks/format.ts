// Pure helpers: number formats, severity colours and the one-line text form.
import type { CpaAccount, CpaSnapshot, CpaTotals, CpaWindow, Placement, Style } from '../types'

export const STYLES: readonly { value: Style; label: string }[] = [
  { value: 'classic', label: '经典' },
  { value: 'compact', label: '紧凑' },
  { value: 'card', label: '卡片' },
  { value: 'gauge', label: '仪表盘' },
]

export const PLACEMENTS: readonly { value: Placement; label: string }[] = [
  { value: 'above', label: '输入框上方' },
  { value: 'pane', label: '侧边面板' },
  { value: 'widget', label: '小挂件' },
  { value: 'status', label: '状态行' },
]

const ERRORS: Record<string, string> = {
  'no-config': '未找到 ~/.cpa/query.json：先运行一次 CPA 查询并保存配置',
  'bad-config': '~/.cpa/query.json 缺少 base_url、proxy_url 或 api_key',
  'run-failed': 'PowerShell 查询脚本运行失败',
  'http-0': '连接失败：检查代理是否开启',
  'http-401': 'Key 无效或已撤销',
  'http-404': '入口未配置该接口',
  'http-429': '查询过于频繁，调大刷新间隔',
}

export function errorText(code: string): string {
  return ERRORS[code] ?? code.replace(/^http-/, 'HTTP ')
}

export function positive(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function isStyle(value: unknown): value is Style {
  return STYLES.some(s => s.value === value)
}

export function isPlacement(value: unknown): value is Placement {
  return PLACEMENTS.some(p => p.value === value)
}

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

export function usd(t: CpaTotals): string {
  if (t.cost === null) return '?'
  return `${t.partial ? '*' : ''}${t.approx ? '~' : ''}$${t.cost.toFixed(2)}`
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d${Math.floor((s % 86_400) / 3600)}h`
  if (s >= 3600) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m`
  return `${s}s`
}

export function percent(remaining: number | null): string {
  return remaining === null ? '?' : `${remaining.toFixed(0)}%`
}

// How a remaining share reads: the meter's fill and track (status palette, fixed),
// the terminal's theme colour, and the word that goes with it so colour never says it alone.
export type Severity = { fill: string; track: string; term: string; tag: string | null }

const GOOD = '#0ca30c'
const WARNING = '#fab219'
const SERIOUS = '#ec835a'
const CRITICAL = '#d03b3b'
const MUTED = '#8a8a85'

function level(fill: string, term: string, tag: string | null): Severity {
  // The track is a lighter step of the fill's own hue, so the state reads across the whole bar.
  return { fill, track: `${fill}33`, term, tag }
}

export function severity(remaining: number | null, isStale: boolean): Severity {
  if (isStale) return level(MUTED, 'inactive', '旧值')
  if (remaining === null) return level(MUTED, 'inactive', '未知')
  if (remaining <= 0) return level(CRITICAL, 'error', '耗尽')
  if (remaining < 5) return level(CRITICAL, 'error', '低')
  if (remaining <= 20) return level(SERIOUS, 'error', '低')
  if (remaining <= 50) return level(WARNING, 'warning', null)
  return level(GOOD, 'success', null)
}

export function textBar(remaining: number | null, cells: number): string {
  const filled = remaining === null ? 0 : Math.round((cells * remaining) / 100)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

// Time to the window's reset; NaN when unknown or the window is full.
export function resetIn(w: CpaWindow, now: number): number {
  return w.resetsAt && w.remaining !== 100 ? Date.parse(w.resetsAt) - now : NaN
}

export function period(snapshot: CpaSnapshot, name: string): CpaTotals | undefined {
  return snapshot.usage?.windows.find(w => w.period === name)
}

// One plain line for the status row and the widget: no colour, no controls.
export function statusLine(
  snapshot: CpaSnapshot | null,
  session: { model: string; ctxPercent?: number; cost: number | null; cacheLeft: number | null },
): string {
  const parts: string[] = []
  if (!snapshot) parts.push('CPA 查询中…')
  else if (snapshot.error) parts.push(`CPA ${errorText(snapshot.error)}`)
  else {
    const hour = period(snapshot, '1h')
    if (hour) parts.push(`CPA 1h ${usd(hour)}`)
    for (const a of snapshot.quota?.accounts ?? []) {
      parts.push(`${a.label} ${a.windows.map(w => `${w.name} ${percent(w.remaining)}`).join(' ')}`)
    }
  }
  parts.push(session.model)
  if (session.ctxPercent !== undefined) parts.push(`上下文 ${session.ctxPercent}%`)
  if (session.cost !== null) parts.push(`≈$${session.cost.toFixed(2)}`)
  if (session.cacheLeft !== null) {
    parts.push(session.cacheLeft > 0 ? `缓存 ${Math.ceil(session.cacheLeft / 60_000)}m` : '缓存已过期')
  }
  return parts.join(' · ')
}
