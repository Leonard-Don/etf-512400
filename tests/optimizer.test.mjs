import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStrategyOptimizer } from '../src/analysis/optimizer.js'

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

test('训练/测试切分日期落在样本中段', () => {
  const klines = syntheticKlines(260, (i) => 100 * 1.0005 ** i)
  const result = buildStrategyOptimizer({ klines, factorBaskets: baseFactors })
  assert.equal(result.ok, true)
  assert.ok(result.sample.train > 0)
  assert.ok(result.sample.test > 0)
  assert.equal(result.sample.train + result.sample.test, klines.length)
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
