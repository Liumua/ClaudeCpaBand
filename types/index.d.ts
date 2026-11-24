export type CpaTotals = {
  period: string
  requests: number | null
  failed: number | null
  tokens: number | null
  cachePct: number | null
  cost: number | null
  approx: boolean
  partial: boolean
}

export type CpaWindow = { name: string; remaining: number | null; resetsAt: string | null }

export type CpaAccount = { label: string; enabled: boolean; stale: boolean; windows: CpaWindow[] }

// What scripts/fetch.ps1 prints, with when it was read.
export type CpaSnapshot = {
  fetchedAt: number
  error?: string
  usage: { asOf: string | null; windows: CpaTotals[] } | null
  usageError: string | null
  quota: { checkedAt: string | null; accounts: CpaAccount[] } | null
  quotaError: string | null
}

// The main thread's last finished turn: when it ended, the model, how long it took.
export type LastTurn = { endedAt: number; model: string; durationMs: number }

declare module 'claude-code' {
  interface PluginState {
    'cpa-band': {
      cpa: CpaSnapshot | null
      isLoading: boolean
      lastTurn: LastTurn | null
      isFolded: boolean
    }
  }
}
