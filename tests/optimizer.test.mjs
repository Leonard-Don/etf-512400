import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStrategyOptimizer } from '../src/analysis/optimizer.js'
import { DEFAULT_COST_BPS_PER_SIDE } from '../src/analysis/backtestCost.js'

const baseFactors = [
  { trend: 65, risk: 50, weight: 30 },
  { trend: 60, risk: 55, weight: 30 },
  { trend: 55, risk: 60, weight: 20 },
  { trend: 50, risk: 50, weight: 20 },
]

const veryRiskyFactors = [
  { trend: 50, risk: 90, weight: 25 },
  { trend: 50, risk: 85, weight: 25 },
  { trend: 50, risk: 80, weight: 25 },
  { trend: 50, risk: 50, weight: 25 },
]

const expansionFactors = [
  { trend: 80, risk: 30, weight: 25 },
  { trend: 75, risk: 25, weight: 25 },
  { trend: 72, risk: 28, weight: 25 },
  { trend: 70, risk: 30, weight: 25 },
]

function syntheticKlines(days, generator) {
  const start = new Date('2024-01-01')
  const out = []
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    out.push({ date: date.toISOString().slice(0, 10), close: generator(i) })
  }
  return out
}

test('K 线样本不足返回 ok=false 且给出原因', () => {
  const klines = syntheticKlines(80, () => 100)
  const result = buildStrategyOptimizer({ klines, factorBaskets: baseFactors })
  assert.equal(result.ok, false)
  assert.match(result.reason, /样本/)
  assert.equal(result.best, null)
})

test('单调上涨数据下能找到至少一组有效候选并返回稳定性分数', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0008 ** i)
  const result = buildStrategyOptimizer({ klines, factorBaskets: baseFactors })
  assert.equal(result.ok, true)
  assert.ok(result.best?.label)
  assert.ok(result.best.stabilityScore >= 0 && result.best.stabilityScore <= 100)
  assert.ok(result.totalCandidates > 0)
  assert.ok(result.leaderboard.length > 0)
  assert.ok(result.leaderboard.length <= 5)
  assert.ok(result.parameterSurface.validCount > 0)
  assert.ok(result.parameterSurface.recommended?.label)
  assert.ok(result.parameterSurface.stableZone?.label)
  assert.ok(result.parameterSurface.summary.includes('有效候选'))
  assert.ok(result.parameterSurface.stableZone.explanation.includes('头部'))
  assert.ok(result.best.explanation.includes('当前原始仓位'))
})

test('过拟合标签必为 低 / 中 / 高 之一', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0005 ** i)
  const result = buildStrategyOptimizer({ klines, factorBaskets: baseFactors })
  assert.equal(result.ok, true)
  assert.ok(['低', '中', '高'].includes(result.best.overfitRisk))
})

test('因子高风险（≥3）触发防御性 multiplier，当前仓位 ≤ raw exposure', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0008 ** i)
  const result = buildStrategyOptimizer({ klines, factorBaskets: veryRiskyFactors })
  assert.equal(result.ok, true)
  // 只要 raw exposure > 0，multiplier=0.5 后必然小于 raw
  if (result.best.current.rawExposure > 0) {
    assert.ok(
      result.best.current.exposure <= result.best.current.rawExposure + 1e-9,
      `expected exposure ≤ raw, got ${result.best.current.exposure} vs ${result.best.current.rawExposure}`,
    )
  }
  assert.match(result.best.current.factorNote, /减半|不放大/)
})

test('因子共振（positive≥3 且 highRisk≤1）允许 multiplier 略上调', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0008 ** i)
  const result = buildStrategyOptimizer({ klines, factorBaskets: expansionFactors })
  assert.equal(result.ok, true)
  assert.ok(result.best.current.factorOverlay >= 1)
})

test('walk-forward 每折训练/测试窗口为正，且每折窗口小于总样本（多折滚动）', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0005 ** i)
  const result = buildStrategyOptimizer({ klines, factorBaskets: baseFactors })
  assert.equal(result.ok, true)
  assert.ok(result.sample.train > 0)
  assert.ok(result.sample.test > 0)
  // walk-forward 下 sample.train/test 是「单折」窗口大小，必然小于总样本
  assert.ok(result.sample.train + result.sample.test < klines.length)
  assert.ok(result.sample.foldCount >= 2, '260 根样本应能铺出至少 2 折')
  assert.equal(result.sample.walkForward, true)
})

test('leaderboard 每项都带稳定性、过拟合、年化、回撤、仓位', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0005 ** i)
  const result = buildStrategyOptimizer({ klines, factorBaskets: baseFactors })
  assert.equal(result.ok, true)
  result.leaderboard.forEach((item) => {
    assert.ok(typeof item.label === 'string' && item.label.length > 0)
    assert.ok(item.stabilityScore >= 0 && item.stabilityScore <= 100)
    assert.ok(['低', '中', '高'].includes(item.overfitRisk))
    assert.ok(Number.isFinite(item.testAnnualReturn))
    assert.ok(Number.isFinite(item.testMaxDrawdown))
    assert.ok(item.testExposure >= 0 && item.testExposure <= 1)
    assert.ok(['高稳定', '中等稳定', '低稳定'].includes(item.stabilityBand))
    assert.match(item.overfitExplanation, /样本|训练|收益/)
    assert.match(item.explanation, /样本外仓位/)
  })
})

test('best.current.exposure 落在 [0, 1]', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0008 ** i)
  const result = buildStrategyOptimizer({ klines, factorBaskets: expansionFactors })
  assert.equal(result.ok, true)
  assert.ok(
    result.best.current.exposure >= 0 && result.best.current.exposure <= 1,
    `exposure should clamp to [0,1], got ${result.best.current.exposure}`,
  )
})

test('空因子篮 → factorOverlay 退化为 1，exposure 等于 rawExposure', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0008 ** i)
  const result = buildStrategyOptimizer({ klines, factorBaskets: [] })
  assert.equal(result.ok, true)
  assert.equal(result.best.current.factorOverlay, 1)
  assert.match(result.best.current.factorNote, /不/)
  assert.ok(result.best.current.rawExposure > 0, 'raw exposure 必须非零，否则该断言无意义')
  assert.ok(
    Math.abs(result.best.current.exposure - result.best.current.rawExposure) < 1e-9,
    `expected exposure==rawExposure when overlay=1, got ${result.best.current.exposure} vs ${result.best.current.rawExposure}`,
  )
})

test('完全平盘数据 → 年化与回撤皆 0，仓位归零、tone=neutral、action=空仓等待', () => {
  const klines = syntheticKlines(260, () => 100)
  const result = buildStrategyOptimizer({ klines, factorBaskets: baseFactors })
  assert.equal(result.ok, true)
  assert.ok(result.leaderboard.length > 0)
  result.leaderboard.forEach((item) => {
    assert.equal(item.testAnnualReturn, 0)
    assert.equal(item.testMaxDrawdown, 0)
    assert.equal(item.testExposure, 0)
  })
  assert.equal(result.best.current.rawExposure, 0)
  assert.equal(result.best.current.exposure, 0)
  assert.equal(result.best.current.action, '空仓等待')
  assert.equal(result.best.current.tone, 'neutral')
})

test('leaderboard 按 score 降序排列且长度不超过 5', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0006 ** i)
  const result = buildStrategyOptimizer({ klines, factorBaskets: baseFactors })
  assert.equal(result.ok, true)
  assert.ok(result.leaderboard.length > 1, '需要至少 2 个候选才能验证排序')
  assert.ok(result.leaderboard.length <= 5)
  for (let i = 1; i < result.leaderboard.length; i += 1) {
    assert.ok(
      result.leaderboard[i - 1].score >= result.leaderboard[i].score,
      `leaderboard[${i - 1}].score=${result.leaderboard[i - 1].score} 应 ≥ leaderboard[${i}].score=${result.leaderboard[i].score}`,
    )
  }
})

test('单点参数网格也能形成稳定区间和推荐配置', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0007 ** i)
  const result = buildStrategyOptimizer({
    klines,
    factorBaskets: baseFactors,
    parameterGrid: {
      fastWindows: [20],
      slowWindows: [60],
      entryPullbacks: [0.05],
      deepPullbacks: [0.12],
      riskCuts: [0.2],
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.totalCandidates, 1)
  assert.equal(result.parameterSurface.validCount, 1)
  assert.equal(result.parameterSurface.recommended.label, result.best.label)
  assert.match(result.parameterSurface.stableZone.label, /20\/60日趋势/)
})

test('多个等分数候选会进入同一个参数表面 cohort', () => {
  const klines = syntheticKlines(260, () => 100)
  const result = buildStrategyOptimizer({
    klines,
    factorBaskets: baseFactors,
    parameterGrid: {
      fastWindows: [15, 20],
      slowWindows: [60],
      entryPullbacks: [0.05],
      deepPullbacks: [0.12],
      riskCuts: [0.2],
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.parameterSurface.validCount, 2)
  assert.equal(result.parameterSurface.stableZone.candidateCount, 2)
  assert.match(result.parameterSurface.stableZone.label, /15 - 20\/60日趋势/)
})

test('NaN 和缺失 close 会被清洗，不污染参数表面分数', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0006 ** i)
  const dirty = [
    { date: '2023-12-29', close: Number.NaN },
    { date: '2023-12-30' },
    ...klines,
  ]
  const result = buildStrategyOptimizer({ klines: dirty, factorBaskets: baseFactors })
  assert.equal(result.ok, true)
  assert.equal(result.sample.total, 260)
  assert.ok(Number.isFinite(result.parameterSurface.scoreDispersion))
  assert.ok(result.parameterSurface.topWindows.every((item) => Number.isFinite(item.annualReturn)))
})

test('参数网格某一维全是非法值时回退默认网格，不应退化成零候选', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0006 ** i)
  const result = buildStrategyOptimizer({
    klines,
    factorBaskets: baseFactors,
    parameterGrid: {
      fastWindows: [Number.NaN, Number.POSITIVE_INFINITY],
      slowWindows: [60],
      entryPullbacks: [0.05],
      deepPullbacks: [0.12],
      riskCuts: [0.2],
    },
  })

  assert.equal(result.ok, true)
  assert.ok(result.totalCandidates > 0, '非法 fastWindows 应回退默认值并继续生成候选')
  assert.ok(result.parameterSurface.validCount > 0)
})

test('参数网格中的非正值会被过滤，避免生成负窗口或负回撤候选', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0006 ** i)
  const result = buildStrategyOptimizer({
    klines,
    factorBaskets: baseFactors,
    parameterGrid: {
      fastWindows: [-5, 20],
      slowWindows: [0, 60],
      entryPullbacks: [-0.05, 0.05],
      deepPullbacks: [0, 0.12],
      riskCuts: [-0.2, 0.2],
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.totalCandidates, 1)
  assert.equal(result.parameterSurface.recommended.params.fastWindow, 20)
  assert.equal(result.parameterSurface.recommended.params.slowWindow, 60)
  assert.equal(result.parameterSurface.recommended.params.entryPullback, 0.05)
  assert.equal(result.parameterSurface.recommended.params.deepPullback, 0.12)
  assert.equal(result.parameterSurface.recommended.params.riskCut, 0.2)
})

test('参数网格中的小数窗口会被过滤，避免生成非整数交易日均线', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0006 ** i)
  let result

  assert.doesNotThrow(() => {
    result = buildStrategyOptimizer({
      klines,
      factorBaskets: baseFactors,
      parameterGrid: {
        fastWindows: [20.5, 20],
        slowWindows: [60.5, 60],
        entryPullbacks: [0.05],
        deepPullbacks: [0.12],
        riskCuts: [0.2],
      },
    })
  })

  assert.equal(result.ok, true)
  assert.equal(result.totalCandidates, 1)
  assert.equal(result.parameterSurface.recommended.params.fastWindow, 20)
  assert.equal(result.parameterSurface.recommended.params.slowWindow, 60)
})

test('参数网格中的比例阈值超过 100% 会被过滤，避免生成失真回撤候选', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0006 ** i)
  const result = buildStrategyOptimizer({
    klines,
    factorBaskets: baseFactors,
    parameterGrid: {
      fastWindows: [20],
      slowWindows: [60],
      entryPullbacks: [1.2, 0.05],
      deepPullbacks: [1.4, 0.12],
      riskCuts: [1.1, 0.2],
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.totalCandidates, 1)
  assert.equal(result.parameterSurface.recommended.params.entryPullback, 0.05)
  assert.equal(result.parameterSurface.recommended.params.deepPullback, 0.12)
  assert.equal(result.parameterSurface.recommended.params.riskCut, 0.2)
})

test('参数网格正值但组合约束全不成立时回退默认网格', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0006 ** i)
  const result = buildStrategyOptimizer({
    klines,
    factorBaskets: baseFactors,
    parameterGrid: {
      fastWindows: [100],
      slowWindows: [110],
      entryPullbacks: [0.1],
      deepPullbacks: [0.12],
      riskCuts: [0.2],
    },
  })

  assert.equal(result.ok, true)
  assert.ok(result.totalCandidates > 0, '组合约束全失败时应回退默认候选')
  assert.ok(result.parameterSurface.validCount > 0)
})

test('参数网格为 null 时回退默认网格，不应抛错', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0006 ** i)
  const result = buildStrategyOptimizer({
    klines,
    factorBaskets: baseFactors,
    parameterGrid: null,
  })

  assert.equal(result.ok, true)
  assert.ok(result.totalCandidates > 0)
  assert.ok(result.parameterSurface.validCount > 0)
})

test('参数表面 summary 解释稳健覆盖、离散标签和 top window 原因', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0006 ** i)
  const result = buildStrategyOptimizer({ klines, factorBaskets: baseFactors })
  assert.equal(result.ok, true)
  assert.match(result.parameterSurface.summary, /稳健覆盖/)
  assert.ok(['尖峰明显', '有一定分化', '头部分数接近'].includes(result.parameterSurface.dispersionLabel))
  assert.ok(['高稳定', '中等稳定', '低稳定'].includes(result.parameterSurface.stabilityBand))
  assert.ok(result.parameterSurface.recommended.explanation.includes('推荐它是因为'))
  assert.ok(result.parameterSurface.topWindows[0].explanation.includes('平均稳定性'))
})

test('非法负数成本覆盖值不会让优化器按零成本计算或在摘要里泄漏负 bps', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0008 ** i)
  const singlePointGrid = {
    fastWindows: [20],
    slowWindows: [60],
    entryPullbacks: [0.05],
    deepPullbacks: [0.12],
    riskCuts: [0.2],
  }
  const invalidCost = buildStrategyOptimizer({
    klines,
    factorBaskets: baseFactors,
    parameterGrid: singlePointGrid,
    costBpsPerSide: -20,
  })
  const defaultCost = buildStrategyOptimizer({
    klines,
    factorBaskets: baseFactors,
    parameterGrid: singlePointGrid,
  })

  assert.equal(invalidCost.ok, true)
  assert.equal(defaultCost.ok, true)
  assert.equal(invalidCost.walkForward.costBpsPerSide, DEFAULT_COST_BPS_PER_SIDE)
  assert.equal(invalidCost.best.test.costDrag, defaultCost.best.test.costDrag)
  assert.ok(invalidCost.best.test.costDrag > 0)
  assert.ok(!invalidCost.walkForward.summary.includes('-20 bps'))
})
