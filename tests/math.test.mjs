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

test('clamp 退化与 NaN 传播', () => {
  // 上下界相等时强制返回该值
  assert.equal(clamp(5, 3, 3), 3)
  assert.equal(clamp(0, 3, 3), 3)
  // NaN 经 Math.min/Math.max 传播；clamp 不应静默吃掉 NaN
  assert.ok(Number.isNaN(clamp(NaN, 0, 10)))
})

test('average 单值与全部 Infinity', () => {
  assert.equal(average([7]), 7)
  // ±Infinity 不是有限值，应被 Number.isFinite 过滤掉 → 全部过滤 → null
  assert.equal(average([Infinity, -Infinity]), null)
})

test('dailyReturns 空数组与单元素均返回空序列', () => {
  assert.deepEqual(dailyReturns([]), [])
  assert.deepEqual(dailyReturns([{ close: 10 }]), [])
})

test('cleanKlines 空数组直接返回空', () => {
  assert.deepEqual(cleanKlines([]), [])
})

test('maxDrawdownFromCurve 空曲线与单点均返回 0', () => {
  // 空曲线时 peak 通过 `?? 1` 兜底，forEach 不执行，回撤为 0
  assert.equal(maxDrawdownFromCurve([]), 0)
  // 单点曲线无回撤
  assert.equal(maxDrawdownFromCurve([0.8]), 0)
})

test('annualizedReturn 拒绝低于 -100% 的累计收益与非正期数', () => {
  assert.equal(annualizedReturn(-1.5, 252), 0)
  assert.equal(annualizedReturn(0.1, -10), 0)
})

test('scoreFromReturn 下限夹紧与 ±Infinity 走中性分支', () => {
  // 50 + (-1)*100 = -50 → 夹到 0
  assert.equal(scoreFromReturn(-1, 100), 0)
  // ±Infinity 不是有限值 → 走中性 50
  assert.equal(scoreFromReturn(Infinity, 100), 50)
  assert.equal(scoreFromReturn(-Infinity, 100), 50)
})

test('movingAverage days=1 退化为当日 close', () => {
  const k = [{ close: 10 }, { close: 12 }, { close: 11 }]
  assert.equal(movingAverage(k, 0, 1), 10)
  assert.equal(movingAverage(k, 2, 1), 11)
})

test('trailingHigh 起点处部分窗口 start 被夹到 0', () => {
  const k = [{ close: 7 }, { close: 9 }, { close: 8 }]
  // endIndex=0, days=5：start=max(0,-4)=0，窗口仅包含第 0 项
  assert.equal(trailingHigh(k, 0, 5), 7)
  // endIndex=1, days=5：窗口为前两项，最大值 9
  assert.equal(trailingHigh(k, 1, 5), 9)
})

test('buildFactorProfile 空 baskets 全部归零', () => {
  const profile = buildFactorProfile([])
  // totalWeight 为 0 时被 || 1 兜底，分子也为 0 → 比值为 0
  assert.equal(profile.trendScore, 0)
  assert.equal(profile.riskScore, 0)
  assert.equal(profile.positiveFactors, 0)
  assert.equal(profile.highRiskFactors, 0)
})
