import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  annualizedReturn,
  average,
  buildFactorProfile,
  cleanKlines,
  clamp,
  dailyReturns,
  maxDrawdownFromCurve,
  movingAverage,
  realizedVolatilityFromReturns,
  scoreFromReturn,
  trailingHigh,
} from '../src/analysis/math.js'

const approx = (actual, expected, tol = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `期望 ${expected} ± ${tol}，实际 ${actual}`,
  )
}

test('clamp 边界', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-1, 0, 10), 0)
  assert.equal(clamp(11, 0, 10), 10)
})

test('average 过滤非有限值并对空数组返回 null', () => {
  assert.equal(average([1, 2, 3]), 2)
  assert.equal(average([]), null)
  approx(average([NaN, 1, 2]), 1.5)
  assert.equal(average([NaN]), null)
})

test('dailyReturns 计算逐日收益', () => {
  const series = [{ close: 10 }, { close: 11 }, { close: 11 }, { close: 9.9 }]
  const result = dailyReturns(series)
  approx(result[0], 0.1)
  approx(result[1], 0)
  approx(result[2], -0.1)
  assert.equal(result.length, 3)
})

test('cleanKlines 排序并过滤无效 close', () => {
  const input = [
    { date: '2024-01-02', close: 11 },
    { date: '2024-01-01', close: 10 },
    { date: '2024-01-03', close: NaN },
  ]
  const cleaned = cleanKlines(input)
  assert.equal(cleaned.length, 2)
  assert.equal(cleaned[0].date, '2024-01-01')
  assert.equal(cleaned[1].date, '2024-01-02')
})

test('realizedVolatilityFromReturns 常数收益 → 0', () => {
  approx(realizedVolatilityFromReturns([0.01, 0.01, 0.01]), 0)
})

test('realizedVolatilityFromReturns 交替收益的年化标准差', () => {
  // returns: [+0.01, -0.01, +0.01, -0.01]，均值 0，样本标准差 ≈ 0.01154700538
  // 年化后 ≈ 0.01154700538 * sqrt(252) ≈ 0.183303
  approx(realizedVolatilityFromReturns([0.01, -0.01, 0.01, -0.01]), 0.18330302779823357, 1e-9)
})

test('realizedVolatilityFromReturns 样本不足返回 null', () => {
  assert.equal(realizedVolatilityFromReturns([0.01]), null)
  assert.equal(realizedVolatilityFromReturns([]), null)
})

test('maxDrawdownFromCurve 计算从历史峰值的回撤', () => {
  approx(maxDrawdownFromCurve([1, 1.1, 0.99, 1.05]), 0.99 / 1.1 - 1)
  approx(maxDrawdownFromCurve([1, 1.2, 1.5]), 0)
})

test('annualizedReturn 边界与一年/半年标定', () => {
  assert.equal(annualizedReturn(0, 252), 0)
  approx(annualizedReturn(0.1, 252), 0.1)
  approx(annualizedReturn(0.05, 126), 1.05 ** 2 - 1)
  assert.equal(annualizedReturn(0, 0), 0)
  assert.equal(annualizedReturn(-1, 252), 0)
})

test('movingAverage 样本不足返回 null', () => {
  const k = [{ close: 1 }, { close: 2 }, { close: 3 }, { close: 4 }]
  assert.equal(movingAverage(k, 1, 3), null)
  approx(movingAverage(k, 2, 3), 2)
  approx(movingAverage(k, 3, 3), 3)
})

test('trailingHigh 取窗口内 close 最大值', () => {
  const k = [{ close: 1 }, { close: 5 }, { close: 3 }, { close: 4 }]
  assert.equal(trailingHigh(k, 3, 4), 5)
  assert.equal(trailingHigh(k, 3, 2), 4)
})

test('trailingHigh 全部缺失或空数组时返回 null', () => {
  assert.equal(trailingHigh([], 0, 5), null)
  assert.equal(
    trailingHigh([{ close: NaN }, { close: undefined }], 1, 5),
    null,
  )
})

test('buildFactorProfile 加权聚合 + 计数器', () => {
  const baskets = [
    { trend: 70, risk: 60, weight: 50 },
    { trend: 50, risk: 80, weight: 50 },
  ]
  const profile = buildFactorProfile(baskets)
  approx(profile.trendScore, 60)
  approx(profile.riskScore, 70)
  // trend >= 65 仅第一个；risk >= 70 仅第二个
  assert.equal(profile.positiveFactors, 1)
  assert.equal(profile.highRiskFactors, 1)
})

test('buildFactorProfile 权重总和 0 时退化为算术平均', () => {
  const baskets = [
    { trend: 60, risk: 50, weight: 0 },
    { trend: 80, risk: 50, weight: 0 },
  ]
  const profile = buildFactorProfile(baskets)
  // weight 为 0 时分子也为 0 → trendScore = 0/1 = 0
  assert.equal(profile.trendScore, 0)
  assert.equal(profile.riskScore, 0)
})

test('scoreFromReturn 中性 50 + 标度', () => {
  assert.equal(scoreFromReturn(0, 100), 50)
  assert.equal(scoreFromReturn(0.1, 100), 60)
  assert.equal(scoreFromReturn(NaN, 100), 50)
  assert.equal(scoreFromReturn(1, 100), 100) // clamped
})
