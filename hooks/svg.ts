// SVG drawings for the surfaces that take Svg (desktop, editor, mobile): a macOS-like
// grouped panel with capsule meters, a card grid, a glance, and a lone capsule bar.
// Pure: a plain model in, markup out. Light and dark follow prefers-color-scheme.
import type { CpaAccount } from '../types'
import { duration, percent, resetIn, severity } from './format'

export type Metric = { label: string; value: string; sub?: string }

export type Panel = {
  metrics: Metric[]
  accounts: readonly CpaAccount[]
  // Shown in place of the accounts: a failed query, or still loading.
  notice?: string
  now: number
}

export type Drawing = { source: string; width: number; height: number; alt: string }

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', sans-serif"

// Semantic inks, dark first; light overrides by media query.
const STYLE = [
  `text{font-family:${FONT};}`,
  '.p{fill:rgba(255,255,255,0.92)}',
  '.s{fill:rgba(235,235,245,0.6)}',
  '.t{fill:rgba(235,235,245,0.3)}',
  '.bg{fill:rgba(255,255,255,0.045);stroke:rgba(255,255,255,0.09)}',
  '.sep{stroke:rgba(255,255,255,0.08)}',
  '@media (prefers-color-scheme: light){',
  '.p{fill:rgba(0,0,0,0.88)}.s{fill:rgba(60,60,67,0.6)}.t{fill:rgba(60,60,67,0.3)}',
  '.bg{fill:rgba(0,0,0,0.03);stroke:rgba(0,0,0,0.08)}.sep{stroke:rgba(0,0,0,0.08)}}',
].join('')

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Cuts text to fit `px` at `size`, with an ellipsis: wide (CJK) glyphs count as a full em,
// the rest as a little over half. An estimate, kept on the safe side.
function fit(value: string, px: number, size: number): string {
  const widthOf = (ch: string) => (ch.charCodeAt(0) >= 0x2e80 ? size : size * 0.6)
  let used = 0
  let out = ''
  for (const ch of value) {
    used += widthOf(ch)
    if (used > px) return out.length > 0 ? `${out.slice(0, -1)}…` : ''
    out += ch
  }
  return out
}

function svg(width: number, height: number, body: string, alt: string): Drawing {
  const w = Math.round(width)
  const h = Math.round(height)
  return {
    source: `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><style>${STYLE}</style>${body}</svg>`,
    width: w,
    height: h,
    alt,
  }
}

function text(x: number, y: number, value: string, cls: string, size: number, opts: { anchor?: 'start' | 'end' | 'middle'; weight?: number } = {}): string {
  const anchor = opts.anchor && opts.anchor !== 'start' ? ` text-anchor='${opts.anchor}'` : ''
  const weight = opts.weight ? ` font-weight='${opts.weight}'` : ''
  return `<text x='${x}' y='${y}' class='${cls}' font-size='${size}'${anchor}${weight} style='font-variant-numeric:tabular-nums'>${esc(value)}</text>`
}

// A capsule: the track is a lighter step of the fill's hue; the fill keeps its round ends.
function capsule(x: number, y: number, w: number, h: number, remaining: number | null, stale: boolean): string {
  const sev = severity(remaining, stale)
  const share = remaining === null ? 0 : Math.max(0, Math.min(100, remaining)) / 100
  const r = h / 2
  const fillW = share > 0 ? Math.max(h, w * share) : 0
  return [
    `<rect x='${x}' y='${y}' width='${w}' height='${h}' rx='${r}' fill='${sev.fill}' fill-opacity='0.2'/>`,
    fillW > 0 ? `<rect x='${x}' y='${y}' width='${fillW.toFixed(1)}' height='${h}' rx='${r}' fill='${sev.fill}'/>` : '',
  ].join('')
}

function tag(account: CpaAccount): string {
  if (!account.enabled) return '已禁用'
  return account.stale ? '旧值' : ''
}

// The meter rows of one account, from y down; returns the markup and the height used.
// Wide: name · bar · percent · reset on one line. Narrow: the reset goes under the bar.
function accountRows(account: CpaAccount, x: number, y: number, w: number, now: number): { body: string; height: number } {
  const stale = !account.enabled || account.stale
  const isNarrow = w < 300
  const parts: string[] = []
  parts.push(text(x, y + 13, account.label, 'p', 13, { weight: 600 }))
  const note = tag(account)
  if (note) parts.push(text(x + 34, y + 13, note, 's', 11))
  let cy = y + 24
  for (const win of account.windows) {
    const sev = severity(win.remaining, stale)
    const reset = resetIn(win, now)
    const when = Number.isFinite(reset) ? `${duration(reset)}后重置` : win.remaining === 100 ? '已满' : ''
    // The word for a low window leads the line under or beside the bar, so colour never says it alone.
    const resetText = sev.tag && sev.tag !== '旧值' ? [sev.tag, when].filter(Boolean).join(' · ') : when
    const nameW = 24
    const pctW = 44
    const resetW = isNarrow ? 0 : 112
    const barX = x + nameW
    const barW = Math.max(40, w - nameW - pctW - resetW - 8)
    parts.push(text(x, cy + 10, win.name, 's', 11))
    parts.push(capsule(barX, cy + 3, barW, 8, win.remaining, stale))
    parts.push(text(barX + barW + 8 + pctW - 6, cy + 11, percent(win.remaining), 'p', 13, { anchor: 'end', weight: 600 }))
    if (!isNarrow && resetText) parts.push(text(x + w, cy + 11, fit(resetText, resetW - 4, 11), 's', 11, { anchor: 'end' }))
    cy += 20
    if (isNarrow && resetText) {
      parts.push(text(barX, cy + 6, resetText, 't', 10))
      cy += 14
    }
  }
  return { body: parts.join(''), height: cy - y + 2 }
}

// Metrics in a row of equal columns (two up when narrow), hairlines between them.
function metricGrid(metrics: Metric[], x: number, y: number, w: number): { body: string; height: number } {
  const perRow = w < 380 ? 2 : Math.min(4, metrics.length)
  const colW = w / perRow
  const rowH = 54
  const parts: string[] = []
  metrics.forEach((m, i) => {
    const col = i % perRow
    const row = Math.floor(i / perRow)
    const mx = x + col * colW
    const my = y + row * rowH
    if (col > 0) parts.push(`<line x1='${mx - 8}' y1='${my + 4}' x2='${mx - 8}' y2='${my + rowH - 10}' class='sep' stroke-width='1'/>`)
    const room = colW - 18
    parts.push(text(mx, my + 13, fit(m.label, room, 11), 's', 11))
    parts.push(text(mx, my + 33, fit(m.value, room, 18), 'p', 18, { weight: 600 }))
    if (m.sub) parts.push(text(mx, my + 48, fit(m.sub, room, 11), 't', 11))
  })
  return { body: parts.join(''), height: Math.ceil(metrics.length / perRow) * rowH }
}

function group(x: number, y: number, w: number, h: number): string {
  return `<rect x='${x + 0.5}' y='${y + 0.5}' width='${w - 1}' height='${h - 1}' rx='12' class='bg' stroke-width='1'/>`
}

function altOf(p: Panel): string {
  const quota = p.accounts.map(a => `${a.label} ${a.windows.map(w => `${w.name} ${percent(w.remaining)}`).join(' ')}`).join('；')
  return [p.metrics.map(m => `${m.label} ${m.value}`).join('，'), quota || p.notice || ''].filter(Boolean).join('。')
}

// The accounts as a grid of columns, each column at least `minCol` wide; returns the
// markup and the height used. Rows of the grid take their tallest account.
function accountGrid(accounts: readonly CpaAccount[], x: number, y: number, w: number, now: number, minCol: number): { body: string; height: number } {
  const gap = 28
  const cols = Math.max(1, Math.min(3, accounts.length, Math.floor((w + gap) / (minCol + gap))))
  const colW = (w - gap * (cols - 1)) / cols
  const parts: string[] = []
  let cy = y
  for (let i = 0; i < accounts.length; i += cols) {
    const row = accounts.slice(i, i + cols).map((acc, j) => accountRows(acc, x + j * (colW + gap), cy, colW, now))
    row.forEach(r => parts.push(r.body))
    cy += Math.max(...row.map(r => r.height)) + 10
  }
  return { body: parts.join(''), height: Math.max(0, cy - y - 10) }
}

// 仪表盘: one grouped panel: the metrics across the top in equal columns, a hairline, then
// the accounts, in as many columns as the width holds.
export function dashboardSvg(p: Panel, width: number): Drawing {
  const pad = 18
  const innerW = width - pad * 2
  const parts: string[] = []
  const grid = metricGrid(p.metrics, pad, pad, innerW)
  let y = pad + grid.height + 2
  parts.push(grid.body, `<line x1='${pad}' y1='${y}' x2='${width - pad}' y2='${y}' class='sep' stroke-width='1'/>`)
  y += 14
  parts.push(text(pad, y + 11, '账号额度', 's', 11, { weight: 600 }))
  y += 20
  if (p.notice) {
    parts.push(text(pad, y + 12, p.notice, 's', 12))
    y += 22
  }
  const accounts = accountGrid(p.accounts, pad, y, innerW, p.now, 330)
  parts.push(accounts.body)
  y += accounts.height
  const h = y + pad
  return svg(width, h, group(0, 0, width, h) + parts.join(''), altOf(p))
}

// 卡片: separate rounded cards in a grid, equal widths per row: usage metrics, one card
// per account, the session.
export function cardsSvg(p: Panel, session: Metric[], width: number): Drawing {
  const gap = 10
  const minCard = 230
  const perRow = Math.max(1, Math.min(3, Math.floor((width + gap) / (minCard + gap))))
  const cardW = (width - gap * (perRow - 1)) / perRow
  type Card = { draw: (x: number, y: number, rowH: number) => string; height: number }
  const cards: Card[] = []
  const metricCard = (title: string, metrics: Metric[]): Card => {
    const rows = metrics.length
    const height = 30 + rows * 22 + 8
    return {
      height,
      draw: (x, y, rowH) => [
        group(x, y, cardW, rowH),
        text(x + 14, y + 20, title, 's', 11, { weight: 600 }),
        ...metrics.map((m, i) => [
          text(x + 14, y + 44 + i * 22, fit(m.label, cardW * 0.4, 12), 's', 12),
          text(x + cardW - 14, y + 44 + i * 22, fit(m.value, cardW * 0.6 - 32, 13), 'p', 13, { anchor: 'end', weight: 600 }),
        ].join('')),
      ].join(''),
    }
  }
  cards.push(metricCard('CPA 用量', p.metrics))
  for (const a of p.accounts) {
    const rows = accountRows(a, 0, 0, cardW - 28, p.now)
    const height = rows.height + 26
    cards.push({
      height,
      draw: (x, y, rowH) => group(x, y, cardW, rowH) + accountRows(a, x + 14, y + 12, cardW - 28, p.now).body,
    })
  }
  if (p.notice) cards.push(metricCard('账号额度', [{ label: p.notice, value: '' }]))
  cards.push(metricCard('会话', session))

  const parts: string[] = []
  let y = 0
  for (let i = 0; i < cards.length; i += perRow) {
    const row = cards.slice(i, i + perRow)
    const rowH = Math.max(...row.map(c => c.height))
    row.forEach((c, j) => parts.push(c.draw(j * (cardW + gap), y, rowH)))
    y += rowH + gap
  }
  return svg(width, Math.max(1, y - gap), parts.join(''), altOf(p))
}

// The widget: the meter list alone, tight.
export function glanceSvg(p: Panel, width: number, footer: string): Drawing {
  const pad = 12
  let y = pad - 4
  const parts: string[] = []
  if (p.notice) {
    parts.push(text(pad, y + 14, p.notice, 's', 12))
    y += 22
  }
  for (const a of p.accounts) {
    const rows = accountRows(a, pad, y, width - pad * 2, p.now)
    parts.push(rows.body)
    y += rows.height + 4
  }
  if (footer) {
    parts.push(text(pad, y + 12, footer, 's', 11))
    y += 18
  }
  const h = y + pad - 4
  return svg(width, h, group(0, 0, width, h) + parts.join(''), altOf(p))
}

// One capsule bar, for the text styles' rows.
export function capsuleSvg(remaining: number | null, stale: boolean, width: number): Drawing {
  return svg(width, 10, capsule(0, 1, width, 8, remaining, stale), percent(remaining))
}
