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

test('buildHistoryReplay 日期 asOf 优先匹配交易日，避免被同日生成的旧交易帧抢走', () => {
  const archive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-05-07',
      generatedAt: '2026-05-19T08:54:01.799Z',
    }),
    snapshot({
      tradeDate: '2026-05-19',
      generatedAt: '2026-05-19T09:07:08.643Z',
    }),
  ])

  const replay = buildHistoryReplay(archive, { asOf: '2026-05-19' })
  assert.equal(replay.currentFrame.date, '2026-05-19')
  assert.equal(replay.selection.matchedDate, '2026-05-19')
  assert.equal(replay.selection.matchedGeneratedAt, '2026-05-19T09:07:08.643Z')
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

test('buildHistoryReplay 多帧趋势全等时峰谷锁定到首帧（避免选择歧义）', () => {
  const archive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-28',
      drivers: [{ key: 'gold', ok: true, trendScore: 60, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-29',
      drivers: [{ key: 'gold', ok: true, trendScore: 60, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      drivers: [{ key: 'gold', ok: true, trendScore: 60, riskScore: 30 }],
    }),
  ])
  const replay = buildHistoryReplay(archive)
  assert.equal(replay.summary.peakTrend.date, '2026-04-28')
  assert.equal(replay.summary.peakTrend.avgTrend, 60)
  assert.equal(replay.summary.troughTrend.date, '2026-04-28')
  assert.equal(replay.summary.troughTrend.avgTrend, 60)
  assert.equal(replay.summary.trendDelta, 0)
  assert.equal(replay.summary.trendDirection, 'flat')
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
      matchedGeneratedAt: null,
      fallbackReason: 'no-frames',
      availableDates: [],
      dedupedDates: [],
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
    matchedGeneratedAt: '2026-04-30T06:29:39.104Z',
    fallbackReason: 'no-as-of',
    availableDates: ['2026-04-28', '2026-04-29', '2026-04-30'],
    dedupedDates: [],
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
    matchedGeneratedAt: '2026-04-29T06:29:39.104Z',
    fallbackReason: null,
    availableDates: ['2026-04-28', '2026-04-29', '2026-04-30'],
    dedupedDates: [],
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
    matchedGeneratedAt: null,
    fallbackReason: 'no-match',
    availableDates: ['2026-04-29', '2026-04-30'],
    dedupedDates: [],
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
        matchedGeneratedAt: '2026-04-30T06:29:39.104Z',
        fallbackReason: 'invalid-as-of',
        availableDates: ['2026-04-29', '2026-04-30'],
        dedupedDates: [],
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
        matchedGeneratedAt: '2026-04-30T06:29:39.104Z',
        fallbackReason: 'invalid-as-of',
        availableDates: ['2026-04-29', '2026-04-30'],
        dedupedDates: [],
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

test('buildHistoryReplay 同日多个归档帧时按最新 generatedAt 去重，避免 as-of 命中歧义', () => {
  const archive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T06:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T08:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 80, riskScore: 30 }],
    }),
    snapshot({ tradeDate: '2026-04-29' }),
  ])

  const replay = buildHistoryReplay(archive)
  assert.equal(replay.frames.length, 2, '同日多帧必须去重为唯一一帧')
  assert.deepEqual(
    replay.selection.availableDates,
    ['2026-04-29', '2026-04-30'],
    'availableDates 必须按日期唯一升序，避免审计提示重复',
  )
  const winning = replay.frames.find((frame) => frame.date === '2026-04-30')
  assert.equal(
    winning.generatedAt,
    '2026-04-30T08:00:00.000Z',
    '保留最新 generatedAt 帧，确保 as-of 选择确定',
  )
  assert.equal(winning.signal.avgTrend, 80, '保留的帧指标应来自最新 generatedAt 的归档记录')

  // 默认当前帧 = 最新日期 = 去重后的那一帧
  assert.equal(replay.currentFrame.date, '2026-04-30')
  assert.equal(replay.currentFrame.generatedAt, '2026-04-30T08:00:00.000Z')

  // asOf 命中应锁定到去重后的那一帧
  const matched = buildHistoryReplay(archive, { asOf: '2026-04-30' })
  assert.equal(matched.currentFrame.generatedAt, '2026-04-30T08:00:00.000Z')
  assert.equal(matched.selection.matchedDate, '2026-04-30')
  assert.equal(matched.selection.fallbackReason, null)

  // 输入顺序反转后结果应保持一致（去重不依赖输入排序）
  const reversed = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T08:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 80, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T06:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
    }),
    snapshot({ tradeDate: '2026-04-29' }),
  ])
  const reversedReplay = buildHistoryReplay(reversed)
  assert.equal(reversedReplay.frames.length, 2)
  const reversedWinning = reversedReplay.frames.find((frame) => frame.date === '2026-04-30')
  assert.equal(reversedWinning.generatedAt, '2026-04-30T08:00:00.000Z')
  assert.equal(reversedWinning.signal.avgTrend, 80)
})

test('buildHistoryReplay 同日多帧时缺 generatedAt 的记录始终让位给有 generatedAt 的记录', () => {
  // 没有 generatedAt 的原始记录，归一化后 generatedAt 为 null；不应顶掉有时间戳的同日帧
  const sansGenAt = {
    tradeDate: '2026-04-30',
    price: 2.0,
    nav: 2.0,
    premium: 0.001,
    changePercent: 0,
    amountCny: 100,
    turnoverRate: 0.01,
    drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
  }
  const withGenAt = snapshot({
    tradeDate: '2026-04-30',
    generatedAt: '2026-04-30T08:00:00.000Z',
    drivers: [{ key: 'gold', ok: true, trendScore: 80, riskScore: 30 }],
  })

  // 有 generatedAt 的帧先到，仍胜出
  const provenanceFirst = buildHistoryReplay(normalizeHistoryArchive([withGenAt, sansGenAt]))
  assert.equal(provenanceFirst.frames.length, 1)
  assert.equal(provenanceFirst.frames[0].generatedAt, '2026-04-30T08:00:00.000Z')
  assert.equal(provenanceFirst.frames[0].signal.avgTrend, 80)
  assert.deepEqual(provenanceFirst.selection.dedupedDates, ['2026-04-30'])

  // 缺 generatedAt 的帧先到，也不该把有时间戳的帧顶掉
  const provenanceLast = buildHistoryReplay(normalizeHistoryArchive([sansGenAt, withGenAt]))
  assert.equal(provenanceLast.frames.length, 1)
  assert.equal(provenanceLast.frames[0].generatedAt, '2026-04-30T08:00:00.000Z')
  assert.equal(provenanceLast.frames[0].signal.avgTrend, 80)
  assert.deepEqual(provenanceLast.selection.dedupedDates, ['2026-04-30'])
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

test('buildHistoryReplay 无重复日期时 selection.dedupedDates 为空数组（保持形状一致）', () => {
  const archive = normalizeHistoryArchive([
    snapshot({ tradeDate: '2026-04-28' }),
    snapshot({ tradeDate: '2026-04-29' }),
    snapshot({ tradeDate: '2026-04-30' }),
  ])
  const replay = buildHistoryReplay(archive)
  assert.ok(
    Object.prototype.hasOwnProperty.call(replay.selection, 'dedupedDates'),
    'selection 必须始终暴露 dedupedDates 字段',
  )
  assert.deepEqual(replay.selection.dedupedDates, [])
})

test('buildHistoryReplay 空骨架 selection.dedupedDates 为空数组（保持形状一致）', () => {
  for (const input of [null, undefined, {}, 42, 'archive', []]) {
    const replay = buildHistoryReplay(input)
    assert.ok(
      Object.prototype.hasOwnProperty.call(replay.selection, 'dedupedDates'),
      'selection 必须始终暴露 dedupedDates 字段',
    )
    assert.deepEqual(replay.selection.dedupedDates, [])
  }
})

test('buildHistoryReplay 同日多帧时 selection.dedupedDates 列出去重日期且唯一升序', () => {
  const archive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T06:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T08:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 80, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-28',
      generatedAt: '2026-04-28T06:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-28',
      generatedAt: '2026-04-28T07:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 50, riskScore: 30 }],
    }),
    snapshot({ tradeDate: '2026-04-29' }),
  ])

  const replay = buildHistoryReplay(archive)
  assert.deepEqual(
    replay.selection.dedupedDates,
    ['2026-04-28', '2026-04-30'],
    'dedupedDates 必须列出曾经出现 >1 帧的日期，唯一升序',
  )
})

test('buildHistoryReplay 同日三帧时 selection.dedupedDates 仍只列该日期一次', () => {
  const archive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T06:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T07:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 60, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T08:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 80, riskScore: 30 }],
    }),
  ])
  const replay = buildHistoryReplay(archive)
  assert.deepEqual(replay.selection.dedupedDates, ['2026-04-30'])
})

test('buildHistoryReplay no-match 时 selection.dedupedDates 仍揭示归档中存在的去重日期', () => {
  const archive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T06:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T08:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 80, riskScore: 30 }],
    }),
  ])
  const replay = buildHistoryReplay(archive, { asOf: '2099-12-31' })
  assert.equal(replay.selection.fallbackReason, 'no-match')
  assert.deepEqual(
    replay.selection.dedupedDates,
    ['2026-04-30'],
    '即使未匹配，dedupedDates 也应反映归档侧的去重状态以便审计',
  )
})

test('buildHistoryReplay selection.matchedGeneratedAt 暴露被选中帧的 generatedAt（同日多帧时关键）', () => {
  const archive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T06:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T08:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 80, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-29',
      generatedAt: '2026-04-29T06:00:00.000Z',
    }),
  ])

  const defaultReplay = buildHistoryReplay(archive)
  assert.equal(
    defaultReplay.selection.matchedGeneratedAt,
    '2026-04-30T08:00:00.000Z',
    '默认 selection 应回显被去重保留的最新 generatedAt 帧',
  )

  const matched = buildHistoryReplay(archive, { asOf: '2026-04-30' })
  assert.equal(
    matched.selection.matchedGeneratedAt,
    '2026-04-30T08:00:00.000Z',
    'asOf 命中去重日期时也应回显胜出的 generatedAt，便于审计',
  )

  const noMatch = buildHistoryReplay(archive, { asOf: '2099-12-31' })
  assert.equal(
    noMatch.selection.matchedGeneratedAt,
    null,
    'asOf 无匹配时 matchedGeneratedAt 必须为 null',
  )

  const empty = buildHistoryReplay([])
  assert.equal(empty.selection.matchedGeneratedAt, null, '空骨架 matchedGeneratedAt 必须为 null')
})

test('buildHistoryReplay selection.matchedGeneratedAt 在 generatedAt 非字符串/空字符串时归一为 null', () => {
  // 防止审计元数据泄漏哨兵：保持与 compareGeneratedAt 一致的有效性判断
  // 否则 memoFormatter 会把 42/NaN/[object Object] 当作"生成时间"打印出来
  const baseSignal = { avgTrend: 70, avgRisk: 30 }
  for (const generatedAt of ['', 42, true, {}, Number.NaN, []]) {
    const replay = buildHistoryReplay([
      { date: '2026-04-30', generatedAt, signal: baseSignal },
    ])
    assert.equal(
      replay.selection.matchedGeneratedAt,
      null,
      `generatedAt=${String(generatedAt)} 应归一为 null（避免泄漏哨兵）`,
    )
  }
})

test('buildHistoryReplay selection.matchedGeneratedAt 在 generatedAt 仅含空白时归一为 null', () => {
  // 纯空白的 generatedAt 不是有效时间戳，否则 memoFormatter 会输出 "生成时间:    "
  // 这种伪元数据，researchMemo.replaySelection 也会把空白当时间戳传下去
  const baseSignal = { avgTrend: 70, avgRisk: 30 }
  for (const generatedAt of ['   ', '\t', '\n', '  \t\n  ']) {
    const replay = buildHistoryReplay([
      { date: '2026-04-30', generatedAt, signal: baseSignal },
    ])
    assert.equal(
      replay.selection.matchedGeneratedAt,
      null,
      `generatedAt=${JSON.stringify(generatedAt)} 应归一为 null（空白等同无效时间戳）`,
    )
  }
})

test('buildHistoryReplay selection.dedupedDates 是副本，不被外部突变污染', () => {
  const archive = normalizeHistoryArchive([
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T06:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 40, riskScore: 30 }],
    }),
    snapshot({
      tradeDate: '2026-04-30',
      generatedAt: '2026-04-30T08:00:00.000Z',
      drivers: [{ key: 'gold', ok: true, trendScore: 80, riskScore: 30 }],
    }),
  ])
  const replay = buildHistoryReplay(archive)
  assert.deepEqual(replay.selection.dedupedDates, ['2026-04-30'])
  replay.selection.dedupedDates.push('hacked')

  const replay2 = buildHistoryReplay(archive)
  assert.deepEqual(
    replay2.selection.dedupedDates,
    ['2026-04-30'],
    '后续调用不应受先前突变污染',
  )
})
