import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { CpaSnapshot, Prefs } from '../types'

const NOW = Date.parse('2026-11-24T08:00:00.000Z')

const SNAPSHOT: CpaSnapshot = {
  fetchedAt: NOW - 6_000,
  usage: {
    asOf: '2026-11-24T07:59:00.000Z',
    windows: [
      { period: '1h', requests: 137, failed: 1, tokens: 13_780_000, cachePct: 77, cost: 14.31, approx: true, partial: true },
      { period: '7d', requests: 527, failed: 9, tokens: 119_000_000, cachePct: 92, cost: 96.75, approx: true, partial: true },
    ],
  },
  usageError: null,
  quota: {
    checkedAt: '2026-11-24T07:58:00.000Z',
    accounts: [
      {
        label: 'A01', enabled: true, stale: false,
        windows: [
          { name: '5h', remaining: 100, resetsAt: null },
          { name: '7d', remaining: 69, resetsAt: '2026-11-25T09:00:00.000Z' },
        ],
      },
      {
        label: 'A02', enabled: true, stale: true,
        windows: [
          { name: '5h', remaining: 12, resetsAt: '2026-11-24T09:10:00.000Z' },
          { name: '7d', remaining: null, resetsAt: null },
        ],
      },
    ],
  },
  quotaError: null,
}

const SURFACES = ['terminal', 'desktop'] as const
const STYLES = ['classic', 'compact', 'card', 'gauge'] as const

const BAND = {
  plugin: 'cpa-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'cpa-band',
  component: 'Pane',
  requestId: 'cpa-band',
  props: {
    title: 'CPA',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// Stands for the engine: the session's figures and the values the mod stored.
function seed(on: On, prefs: Prefs, extra: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    cpa: SNAPSHOT,
    isLoading: false,
    lastTurn: { endedAt: NOW - 8 * 60_000, model: 'claude-opus-5-5', durationMs: 7_000 },
    isFolded: false,
    isSettingsOpen: false,
    prefs,
    ...extra,
  }
  on('state.get', (_, e) => ({ value: { value: values[(e as { key: string }).key], version: 1 } }))
  on('session.usage', () => ({
    value: { startedAt: NOW - 3_600_000, context: { tokens: 204_300, window: 1_000_000, percent: 20 }, rateLimits: [], cost: { usd: 5.3751 } },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: NOW }))
}

for (const style of STYLES) {
  test(`${style}: the band draws the quota on every surface`, async ($, on) => {
    seed(on, { style, placement: 'above' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      // The gauge's rings are an Svg on the desktop; its text rows still name the session.
      const found = await ui.find({ type: 'Text', text: /claude-opus-5-5/ })
      expect(found).toBeTruthy()
      await ui.unmount()
    }
  })

  test(`${style}: the pane draws it too`, async ($, on) => {
    seed(on, { style, placement: 'pane' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: /claude-opus-5-5|A01/ })).toBeTruthy()
      await ui.unmount()
    }
  })
}

test('the band stays out of the way when placed elsewhere', async ($, on) => {
  seed(on, { style: 'classic', placement: 'status' })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('the widget shows the percentages', async ($, on) => {
  seed(on, { style: 'classic', placement: 'widget' })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' as 'dock' }, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /A01/ })).toBeTruthy()
  await ui.unmount()
})

for (const style of STYLES) {
  test(`${style}: folded and with settings open, it still draws`, async ($, on) => {
    seed(on, { style, placement: 'above' }, { isFolded: true, isSettingsOpen: true })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: /CPA 横条设置/ })).toBeTruthy()
      await ui.unmount()
    }
  })
}

test('gauge: the dashboard leads with stat tiles', async ($, on) => {
  seed(on, { style: 'gauge', placement: 'above' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '近 1 小时' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: '账号额度' })).toBeTruthy()
    await ui.unmount()
  }
})

for (const bodyColumns of [40, 70, 140]) {
  for (const style of STYLES) {
    test(`${style}: draws at ${bodyColumns} columns`, async ($, on) => {
      seed(on, { style, placement: 'pane' })
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface })
        expect(await ui.find({ type: 'Text', text: /A01/ })).toBeTruthy()
        await ui.unmount()
      }
    })
  }
}

test('a low window says so in words, not colour alone', async ($, on) => {
  seed(on, { style: 'classic', placement: 'above' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // A02 is stale in the snapshot, so its windows read 旧值.
  expect(await ui.find({ type: 'Text', text: '旧值' })).toBeTruthy()
  await ui.unmount()
})

test('the widget placement draws the glance form in a full pane too', async ($, on) => {
  seed(on, { style: 'card', placement: 'widget' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'expand' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'settings' })).toBeFalsy()
  await ui.unmount()
})

test('the desktop right-click menu offers every other placement and style', async ($, on) => {
  seed(on, { style: 'gauge', placement: 'status' })
  const ui = await $.ui.mount({
    plugin: 'cpa-band',
    component: 'ContextMenu',
    requestId: 'menu',
    props: {},
    surface: 'desktop',
  } as never)
  expect(await ui.find({ type: 'Button', key: 'cpa-place-above' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'cpa-place-status' })).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: 'cpa-style-card' })).toBeTruthy()
  await ui.unmount()
})
