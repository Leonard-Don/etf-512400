import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeResearchMemo } from '../src/analysis/researchMemo.js'

const baseSignal = {
  action: '小仓跟踪',
  tone: 'positive',
  score: 70,
  suggestedExposure: 0.4,
  confidence: 75,
  reasons: [
    '趋势状态：上升趋势，20日+5.0%，60日+12.0%',
    '因子状态：3个因子向上，1个因子处于高风险',
    '折溢价：+0.10%，成交额8.00亿',
  ],
  invalidationRules: [
    '价格跌破60日均线且商品驱动没有修复，信号降为风险降档',
    '折溢价高于0.8%或单日急涨超过4.5%，禁止新增追价仓位',
    '高风险因子达到3个及以上，只保留观察仓或等待回撤',
  ],
  factorProfile: { highRiskFactors: 1, positiveFactors: 3 },
}

const baseQuality = {
  action: '可正常执行',
  tone: 'positive',
  score: 78,
  watchPoints: [
    '跟踪口径采用净值，样本 60 日',
    '折溢价 贴近净值，2日溢价',
    '成交额处于近120日 65 分位',
  ],
}

const basePrimary = {
  action: '主仓持有',
  tone: 'positive',
  exposure: 0.6,
  source: '自动优化',
  rule: '20/60日趋势，5%/12%回撤',
  overfitRisk: '低',
  stabilityScore: 78,
  score: 78,
}

const baseTrend = { state: '上升趋势' }

test('composeResearchMemo: headline 含动作 + 仓位百分比', () => {
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: baseSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0.001,
    dailyChange: 0.012,
  })
  assert.match(memo.headline, /主仓持有/)
  assert.match(memo.headline, /60%/)
  assert.equal(memo.tone, 'positive')
  assert.equal(memo.source, '自动优化')
  assert.equal(memo.rule, '20/60日趋势，5%/12%回撤')
})

test('composeResearchMemo: drivers 列出 信号/质量/趋势 三条线', () => {
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: baseSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0.001,
    dailyChange: 0.012,
  })
  assert.equal(memo.drivers.length, 3)
  assert.ok(memo.drivers.some((d) => d.includes('小仓跟踪') && d.includes('70')))
  assert.ok(memo.drivers.some((d) => d.includes('可正常执行') && d.includes('78')))
  assert.ok(memo.drivers.some((d) => d.includes('上升趋势')))
})

test('composeResearchMemo: reasons = signal.reasons + tradingQuality.watchPoints（保持顺序）', () => {
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: baseSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0.001,
    dailyChange: 0.012,
  })
  assert.equal(memo.reasons.length, 6)
  assert.deepEqual(memo.reasons.slice(0, 3), baseSignal.reasons)
  assert.deepEqual(memo.reasons.slice(3), baseQuality.watchPoints)
})

test('composeResearchMemo: invalidations 来自 signal.invalidationRules（解释链一致性）', () => {
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: baseSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0.001,
    dailyChange: 0.012,
  })
  assert.deepEqual(memo.invalidations, baseSignal.invalidationRules)
})

test('composeResearchMemo: 信号 warning 时 tone 与 headline 同步降级', () => {
  const warningPrimary = {
    ...basePrimary,
    action: '禁止追高',
    tone: 'warning',
    exposure: 0.1,
    rule: '20/60日趋势，5%/12%回撤 · 信号 禁止追高',
  }
  const warningSignal = {
    ...baseSignal,
    action: '禁止追高',
    tone: 'warning',
    suggestedExposure: 0.1,
  }
  const memo = composeResearchMemo({
    primaryDecision: warningPrimary,
    signal: warningSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0.012,
    dailyChange: 0.05,
  })
  assert.equal(memo.tone, 'warning')
  assert.match(memo.headline, /禁止追高/)
  assert.match(memo.headline, /10%/)
  assert.match(memo.rule, /信号 禁止追高/)
})

test('composeResearchMemo: metrics 与输入一致', () => {
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: baseSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0.0023,
    dailyChange: 0.015,
  })
  assert.equal(memo.metrics.score, 78)
  assert.equal(memo.metrics.exposure, 0.6)
  assert.equal(memo.metrics.confidence, 75)
  assert.ok(Math.abs(memo.metrics.premium - 0.0023) < 1e-12)
  assert.ok(Math.abs(memo.metrics.dailyChange - 0.015) < 1e-12)
})

test('composeResearchMemo: 缺少 reasons/watchPoints/invalidationRules 时返回空数组、不抛错', () => {
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: { ...baseSignal, reasons: undefined, invalidationRules: undefined },
    tradingQuality: { ...baseQuality, watchPoints: undefined },
    trendProfile: baseTrend,
    premium: 0,
    dailyChange: 0,
  })
  assert.deepEqual(memo.reasons, [])
  assert.deepEqual(memo.invalidations, [])
  assert.equal(memo.drivers.length, 3)
})

test('composeResearchMemo: 默认未提供 replaySelection 时字段为 null', () => {
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: baseSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0.001,
    dailyChange: 0.012,
  })
  assert.ok(
    Object.prototype.hasOwnProperty.call(memo, 'replaySelection'),
    'memo 必须始终暴露 replaySelection 字段以保持形状一致',
  )
  assert.equal(memo.replaySelection, null)
})

test('composeResearchMemo: 显式 replaySelection 透传给 memo 输出', () => {
  const replaySelection = {
    requestedAsOf: '2026-04-30',
    matchedDate: '2026-04-30',
    matchedGeneratedAt: '2026-04-30T06:29:39.104Z',
    fallbackReason: null,
    availableDates: ['2026-04-28', '2026-04-29', '2026-04-30'],
    dedupedDates: [],
  }
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: baseSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0.001,
    dailyChange: 0.012,
    replaySelection,
  })
  assert.deepEqual(memo.replaySelection, replaySelection)
  assert.notEqual(
    memo.replaySelection,
    replaySelection,
    'replaySelection 应是副本而非同引用，避免外部突变污染 memo',
  )
  assert.notEqual(
    memo.replaySelection.availableDates,
    replaySelection.availableDates,
    'availableDates 必须深拷贝，防止下游 push 污染原档',
  )
})

test('composeResearchMemo: 源 replaySelection.availableDates 后续突变不会污染 memo（防御性拷贝不变量）', () => {
  // 上游可能在调用 composeResearchMemo 之后继续把新的回放日期 push 进同一份 selection（例如轮询拉到新档），
  // 但 memo 必须代表"组装那一刻"的快照——下游 push/splice/index 赋值都不能回灌进 memo.replaySelection.availableDates，
  // 否则导出/分享出去的备忘会出现"未来日期穿越回当时决策"的错觉。
  const sourceAvailableDates = ['2026-04-28', '2026-04-29', '2026-04-30']
  const replaySelection = {
    requestedAsOf: '2026-04-30',
    matchedDate: '2026-04-30',
    matchedGeneratedAt: '2026-04-30T06:29:39.104Z',
    fallbackReason: null,
    availableDates: sourceAvailableDates,
    dedupedDates: [],
  }
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: baseSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0.001,
    dailyChange: 0.012,
    replaySelection,
  })
  sourceAvailableDates.push('2026-05-01')
  sourceAvailableDates[0] = 'MUTATED'
  assert.deepEqual(
    memo.replaySelection.availableDates,
    ['2026-04-28', '2026-04-29', '2026-04-30'],
    'memo.replaySelection.availableDates 必须独立于源数组：下游 push/赋值 不能污染 memo 快照',
  )
})

test('composeResearchMemo: replaySelection=null 时显式保留 null 而不丢字段', () => {
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: baseSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0,
    dailyChange: 0,
    replaySelection: null,
  })
  assert.ok(Object.prototype.hasOwnProperty.call(memo, 'replaySelection'))
  assert.equal(memo.replaySelection, null)
})

test('composeResearchMemo: replaySelection.dedupedDates 透传并深拷贝（防外部突变）', () => {
  const replaySelection = {
    requestedAsOf: '2026-04-30',
    matchedDate: '2026-04-30',
    matchedGeneratedAt: '2026-04-30T06:29:39.104Z',
    fallbackReason: null,
    availableDates: ['2026-04-29', '2026-04-30'],
    dedupedDates: ['2026-04-30'],
  }
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: baseSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0.001,
    dailyChange: 0.012,
    replaySelection,
  })
  assert.deepEqual(memo.replaySelection.dedupedDates, ['2026-04-30'])
  assert.notEqual(
    memo.replaySelection.dedupedDates,
    replaySelection.dedupedDates,
    'dedupedDates 必须深拷贝，防止下游 push 污染原档',
  )
})

test('composeResearchMemo: replaySelection.matchedGeneratedAt 仅含空白时归一为 null（与 buildHistoryReplay 对齐）', () => {
  // buildHistoryReplay 已把空白 generatedAt 归一为 null，避免 memo/export 把空白当真时间戳。
  // composeResearchMemo 必须沿用同样契约：上游若绕开 buildHistoryReplay 直接构造 replaySelection，
  // memo.replaySelection.matchedGeneratedAt 仍要归一为 null，否则 JSON 序列化会输出空白伪时间戳，
  // markdown 的 "- 生成时间: " 行也会渲染出可见空白当作真值。
  for (const matchedGeneratedAt of ['   ', '\t', '\n', '  \t\n  ']) {
    const memo = composeResearchMemo({
      primaryDecision: basePrimary,
      signal: baseSignal,
      tradingQuality: baseQuality,
      trendProfile: baseTrend,
      premium: 0.001,
      dailyChange: 0.012,
      replaySelection: {
        requestedAsOf: '2026-04-30',
        matchedDate: '2026-04-30',
        matchedGeneratedAt,
        fallbackReason: null,
        availableDates: ['2026-04-30'],
        dedupedDates: [],
      },
    })
    assert.equal(
      memo.replaySelection.matchedGeneratedAt,
      null,
      `matchedGeneratedAt=${JSON.stringify(matchedGeneratedAt)} 应归一为 null（空白等同无效时间戳）`,
    )
  }
})

test('composeResearchMemo: replaySelection 缺 dedupedDates 时填 [] 保持形状一致', () => {
  const replaySelection = {
    requestedAsOf: '2026-04-30',
    matchedDate: '2026-04-30',
    fallbackReason: null,
    availableDates: ['2026-04-30'],
  }
  const memo = composeResearchMemo({
    primaryDecision: basePrimary,
    signal: baseSignal,
    tradingQuality: baseQuality,
    trendProfile: baseTrend,
    premium: 0,
    dailyChange: 0,
    replaySelection,
  })
  assert.ok(
    Object.prototype.hasOwnProperty.call(memo.replaySelection, 'dedupedDates'),
    'memo.replaySelection 必须始终暴露 dedupedDates 字段',
  )
  assert.deepEqual(memo.replaySelection.dedupedDates, [])
})

test('composeResearchMemo: 非有限 exposure 不让 headline 漏出 NaN/Infinity 哨兵', () => {
  // 现有 headline 用 `Math.round((primaryDecision.exposure ?? 0) * 100)` 拼接，?? 只兜底
  // null/undefined，NaN/±Infinity 会原样穿过 Math.round 并被字符串插值为 "NaN%"/"Infinity%"。
  // formatMemoMarkdown 直接 `## ${memo.headline}` 透传，没有再做哨兵守卫；现有 metrics 的
  // Number.isFinite 防护只覆盖 markdown 指标行，不覆盖 headline。
  // 这一守卫与 memoFormatter.formatExposure 的非有限回退构成对称的 defense-in-depth：
  // composeResearchMemo 是对外暴露的纯函数 API，未来 caller（场景模拟、优化器、UI 试算）
  // 漏掉上游 clamp 时不应直接污染 headline。
  for (const sentinel of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const memo = composeResearchMemo({
      primaryDecision: { ...basePrimary, exposure: sentinel },
      signal: baseSignal,
      tradingQuality: baseQuality,
      trendProfile: baseTrend,
      premium: 0.001,
      dailyChange: 0.012,
    })
    assert.equal(typeof memo.headline, 'string', `exposure=${String(sentinel)} 仍应输出 string headline`)
    assert.ok(
      !memo.headline.includes('NaN'),
      `exposure=${String(sentinel)} 不应让 headline 漏出 NaN 哨兵：${memo.headline}`,
    )
    assert.ok(
      !memo.headline.includes('Infinity'),
      `exposure=${String(sentinel)} 不应让 headline 漏出 Infinity 哨兵：${memo.headline}`,
    )
    assert.ok(
      memo.headline.startsWith(basePrimary.action),
      `exposure=${String(sentinel)} headline 仍应以 action 开头：${memo.headline}`,
    )
  }
})
