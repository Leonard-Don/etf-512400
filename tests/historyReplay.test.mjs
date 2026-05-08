import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeHistoryArchive } from '../src/analysis/historyArchive.js'
import { buildHistoryReplay } from '../src/analysis/historyReplay.js'

function snapshot(overrides = {}) {
  return {
    generatedAt: overrides.generatedAt ?? `${overrides.tradeDate ?? '2026-04-30'}T06:29:39.104Z`,
    tradeDate: overrides.tradeDate ?? '2026-04-30',
    tradeTime: overrides.tradeTime ?? `${overrides.tradeDate ?? '2026-04-30'} 16:11:58`,
    price: overrides.price ?? 2.0,
    nav: overrides.nav ?? 2.0,
    premium: overrides.premium ?? 0.001,
    changePercent: overrides.changePercent ?? 0,
    amountCny: overrides.amountCny ?? 100,
    turnoverRate: overrides.turnoverRate ?? 0.01,
    drivers: overrides.drivers ?? [
      { key: 'gold', ok: true, trendScore: 60, riskScore: 50 },
      { key: 'copper', ok: true, trendScore: 50, riskScore: 40 },
    ],
  }
}

test('buildHistoryReplay 对 null/undefined/非数组输入返回安全空骨架', () => {
  for (const input of [null, undefined, {}, 42, 'archive']) {
    const replay = buildHistoryReplay(input)
    assert.deepEqual(replay.frames, [])
    assert.equal(replay.currentIndex, null)
    assert.equal(replay.currentFrame, null)
    assert.equal(replay.summary.frameCount, 0)
    assert.equal(replay.summary.firstDate, null)
    assert.equal(replay.summary.lastDate, null)
    assert.equal(replay.summary.avgTrend, null)
    assert.equal(replay.summary.avgRisk, null)
    assert.equal(replay.summary.trendDelta, null)
    assert.equal(replay.summary.trendDirection, 'none')
    assert.equal(replay.summary.peakTrend, null)
    assert.equal(replay.summary.troughTrend, null)
  }
})

test('buildHistoryReplay 跳过非对象/缺日期的条目并保持空骨架可用', () => {
  const replay = buildHistoryReplay([null, undefined, {}, { date: '' }])
  assert.deepEqual(replay.frames, [])
  assert.equal(replay.currentIndex, null)
  assert.equal(replay.summary.frameCount, 0)
})

test('buildHistoryReplay 跳过缺少 signal 聚合字段的畸形帧', () => {
  const replay = buildHistoryReplay([
    { date: '2026-04-29' },
    { date: '2026-04-30', signal: { avgTrend: 70, avgRisk: 20 } },
  ])
  assert.equal(replay.frames.length, 1)
  assert.equal(replay.currentFrame.date, '2026-04-30')
  assert.equal(replay.summary.avgTrend, 70)
})

test('buildHistoryReplay 把归档按日期升序排成回放帧并标注 index', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-29' }),
    snapshot({ tradeDate: '2026-04-28' }),
    snapshot({ tradeDate: '2026-04-30' }),
  ])
  const replay = buildHistoryReplay(archive)
  assert.equal(replay.frames.length, 3)
  assert.deepEqual(
    replay.frames.map((frame) => frame.date),
    ['2026-04-28', '2026-04-29', '2026-04-30'],
  )
  assert.deepEqual(
    replay.frames.map((frame) => frame.index),
    [0, 1, 2],
  )
})

test('buildHistoryReplay 默认把当前帧设为最新一条', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-28' }),
    snapshot({ tradeDate: '2026-04-30' }),
    snapshot({ tradeDate: '2026-04-29' }),
  ])
  const replay = buildHistoryReplay(archive)
  assert.equal(replay.currentIndex, 2)
  assert.equal(replay.currentFrame.date, '2026-04-30')
})

test('buildHistoryReplay 用 asOf 日期把当前帧定位到对应历史帧', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-28' }),
    snapshot({ tradeDate: '2026-04-29' }),
    snapshot({ tradeDate: '2026-04-30' }),
  ])
  const replay = buildHistoryReplay(archive, { asOf: '2026-04-29' })
  assert.equal(replay.currentIndex, 1)
  assert.equal(replay.currentFrame.date, '2026-04-29')
})

test('buildHistoryReplay 接受 generatedAt 完整时间戳作为 asOf', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-29', generatedAt: '2026-04-29T07:00:00.000Z' }),
    snapshot({ tradeDate: '2026-04-30', generatedAt: '2026-04-30T07:30:00.000Z' }),
  ])
  const replay = buildHistoryReplay(archive, { asOf: '2026-04-29T07:00:00.000Z' })
  assert.equal(replay.currentIndex, 0)
  assert.equal(replay.currentFrame.date, '2026-04-29')
})

test('buildHistoryReplay 在 asOf 无匹配时把当前帧置空但保留帧列表', () => {
  const archive = normalizeHistoryArchive([snapshot({ tradeDate: '2026-04-30' })])
  const replay = buildHistoryReplay(archive, { asOf: '2025-01-01' })
  assert.equal(replay.frames.length, 1)
  assert.equal(replay.currentIndex, null)
  assert.equal(replay.currentFrame, null)
})

test('buildHistoryReplay summary 计算趋势/风险均值并汇总日期边界', () => {
  const archive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-28',
      drivers: [
        { key: 'gold', ok: true, trendScore: 40, riskScore: 30 },
        { key: 'copper', ok: true, trendScore: 60, riskScore: 50 },
      ],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      drivers: [
        { key: 'gold', ok: true, trendScore: 80, riskScore: 70 },
        { key: 'copper', ok: true, trendScore: 70, riskScore: 60 },
      ],
    }),
  ])
  const replay = buildHistoryReplay(archive)
  assert.equal(replay.summary.frameCount, 2)
  assert.equal(replay.summary.firstDate, '2026-04-28')
  assert.equal(replay.summary.lastDate, '2026-04-30')
  // (50+75)/2 = 62.5
  assert.equal(replay.summary.avgTrend, 62.5)
  // (40+65)/2 = 52.5
  assert.equal(replay.summary.avgRisk, 52.5)
})

test('buildHistoryReplay summary 用首尾差判定趋势方向并暴露 trendDelta', () => {
  const upArchive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-28',
      drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      drivers: [{ key: 'gold', ok: true, trendScore: 80, riskScore: 30 }],
    }),
  ])
  const upReplay = buildHistoryReplay(upArchive)
  assert.equal(upReplay.summary.trendDelta, 40)
  assert.equal(upReplay.summary.trendDirection, 'up')

  const downArchive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-28',
      drivers: [{ key: 'gold', ok: true, trendScore: 80, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
    }),
  ])
  const downReplay = buildHistoryReplay(downArchive)
  assert.equal(downReplay.summary.trendDelta, -40)
  assert.equal(downReplay.summary.trendDirection, 'down')

  const flatArchive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-28',
      drivers: [{ key: 'gold', ok: true, trendScore: 60, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      drivers: [{ key: 'gold', ok: true, trendScore: 60, riskScore: 30 }],
    }),
  ])
  const flatReplay = buildHistoryReplay(flatArchive)
  assert.equal(flatReplay.summary.trendDelta, 0)
  assert.equal(flatReplay.summary.trendDirection, 'flat')
})

test('buildHistoryReplay summary 标记 avgTrend 的峰谷帧', () => {
  const archive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-28',
      drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-29',
      drivers: [{ key: 'gold', ok: true, trendScore: 90, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      drivers: [{ key: 'gold', ok: true, trendScore: 60, riskScore: 30 }],
    }),
  ])
  const replay = buildHistoryReplay(archive)
  assert.equal(replay.summary.peakTrend.date, '2026-04-29')
  assert.equal(replay.summary.peakTrend.avgTrend, 90)
  assert.equal(replay.summary.troughTrend.date, '2026-04-28')
  assert.equal(replay.summary.troughTrend.avgTrend, 40)
})

test('buildHistoryReplay 把空白或非字符串 asOf 视作未指定，回到最新帧', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-28' }),
    snapshot({ tradeDate: '2026-04-29' }),
    snapshot({ tradeDate: '2026-04-30' }),
  ])

  for (const blankAsOf of ['   ', '\t', '\n']) {
    const replay = buildHistoryReplay(archive, { asOf: blankAsOf })
    assert.equal(replay.currentIndex, 2, `blank asOf ${JSON.stringify(blankAsOf)} 应回到最新帧`)
    assert.equal(replay.currentFrame.date, '2026-04-30')
  }

  for (const nonString of [42, true, {}, []]) {
    const replay = buildHistoryReplay(archive, { asOf: nonString })
    assert.equal(replay.currentIndex, 2, `非字符串 asOf ${JSON.stringify(nonString)} 应回到最新帧`)
    assert.equal(replay.currentFrame.date, '2026-04-30')
  }
})

test('buildHistoryReplay 把带前后空白的 asOf 当作 trim 后的日期匹配', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-28' }),
    snapshot({ tradeDate: '2026-04-29' }),
    snapshot({ tradeDate: '2026-04-30' }),
  ])
  const replay = buildHistoryReplay(archive, { asOf: '  2026-04-29  ' })
  assert.equal(replay.currentIndex, 1)
  assert.equal(replay.currentFrame.date, '2026-04-29')
})

test('buildHistoryReplay 单条归档下峰谷为同一帧且方向 flat', () => {
  const archive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-30',
      drivers: [{ key: 'gold', ok: true, trendScore: 75, riskScore: 30 }],
    }),
  ])
  const replay = buildHistoryReplay(archive)
  assert.equal(replay.frames.length, 1)
  assert.equal(replay.currentIndex, 0)
  assert.equal(replay.summary.frameCount, 1)
  assert.equal(replay.summary.trendDelta, 0)
  assert.equal(replay.summary.trendDirection, 'flat')
  assert.equal(replay.summary.peakTrend.date, '2026-04-30')
  assert.equal(replay.summary.troughTrend.date, '2026-04-30')
})

test('buildHistoryReplay 空骨架 selection 标 no-frames 且无可用日期', () => {
  for (const input of [null, undefined, {}, 42, 'archive', []]) {
    const replay = buildHistoryReplay(input)
    assert.deepEqual(replay.selection, {
      requestedAsOf: null,
      matchedDate: null,
      fallbackReason: 'no-frames',
      availableDates: [],
    })
  }
})

test('buildHistoryReplay 默认 selection 为最新帧 + fallbackReason=no-as-of', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-28' }),
    snapshot({ tradeDate: '2026-04-30' }),
    snapshot({ tradeDate: '2026-04-29' }),
  ])
  const replay = buildHistoryReplay(archive)
  assert.deepEqual(replay.selection, {
    requestedAsOf: null,
    matchedDate: '2026-04-30',
    fallbackReason: 'no-as-of',
    availableDates: ['2026-04-28', '2026-04-29', '2026-04-30'],
  })
})

test('buildHistoryReplay 命中 asOf 时 selection.fallbackReason 为 null 且 requestedAsOf 已 trim', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-28' }),
    snapshot({ tradeDate: '2026-04-29' }),
    snapshot({ tradeDate: '2026-04-30' }),
  ])
  const replay = buildHistoryReplay(archive, { asOf: '  2026-04-29  ' })
  assert.deepEqual(replay.selection, {
    requestedAsOf: '2026-04-29',
    matchedDate: '2026-04-29',
    fallbackReason: null,
    availableDates: ['2026-04-28', '2026-04-29', '2026-04-30'],
  })
})

test('buildHistoryReplay asOf 未匹配时 selection 标 no-match 但 availableDates 仍完整', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-29' }),
    snapshot({ tradeDate: '2026-04-30' }),
  ])
  const replay = buildHistoryReplay(archive, { asOf: '2025-01-01' })
  assert.deepEqual(replay.selection, {
    requestedAsOf: '2025-01-01',
    matchedDate: null,
    fallbackReason: 'no-match',
    availableDates: ['2026-04-29', '2026-04-30'],
  })
})

test('buildHistoryReplay 非字符串/空白 asOf 时 selection 标 invalid-as-of 并落到最新帧', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-29' }),
    snapshot({ tradeDate: '2026-04-30' }),
  ])

  for (const blankAsOf of ['   ', '\t', '\n']) {
    const replay = buildHistoryReplay(archive, { asOf: blankAsOf })
    assert.deepEqual(
      replay.selection,
      {
        requestedAsOf: null,
        matchedDate: '2026-04-30',
        fallbackReason: 'invalid-as-of',
        availableDates: ['2026-04-29', '2026-04-30'],
      },
      `blank asOf ${JSON.stringify(blankAsOf)} 应标 invalid-as-of`,
    )
  }

  for (const nonString of [42, true, {}, []]) {
    const replay = buildHistoryReplay(archive, { asOf: nonString })
    assert.deepEqual(
      replay.selection,
      {
        requestedAsOf: null,
        matchedDate: '2026-04-30',
        fallbackReason: 'invalid-as-of',
        availableDates: ['2026-04-29', '2026-04-30'],
      },
      `非字符串 asOf ${JSON.stringify(nonString)} 应标 invalid-as-of`,
    )
  }
})

test('buildHistoryReplay selection.availableDates 是排序后的副本，不被外部突变污染', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-28' }),
    snapshot({ tradeDate: '2026-04-30' }),
  ])
  const replay = buildHistoryReplay(archive)
  assert.deepEqual(replay.selection.availableDates, ['2026-04-28', '2026-04-30'])

  replay.selection.availableDates.push('hacked')
  const replay2 = buildHistoryReplay(archive)
  assert.deepEqual(replay2.selection.availableDates, ['2026-04-28', '2026-04-30'])
})

test('buildHistoryReplay generatedAt 命中时 matchedDate 为对应 date 而非时间戳', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-29', generatedAt: '2026-04-29T07:00:00.000Z' }),
    snapshot({ tradeDate: '2026-04-30', generatedAt: '2026-04-30T07:30:00.000Z' }),
  ])
  const replay = buildHistoryReplay(archive, { asOf: '2026-04-29T07:00:00.000Z' })
  assert.equal(replay.selection.requestedAsOf, '2026-04-29T07:00:00.000Z')
  assert.equal(replay.selection.matchedDate, '2026-04-29')
  assert.equal(replay.selection.fallbackReason, null)
})
