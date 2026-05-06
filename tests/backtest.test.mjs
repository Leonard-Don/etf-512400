import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBacktestStrategies } from '../src/analysis/backtest.js'

const baseFactorBaskets = [
  { trend: 65, risk: 50, weight: 30 },
  { trend: 60, risk: 55, weight: 30 },
  { trend: 55, risk: 60, weight: 20 },
  { trend: 50, risk: 50, weight: 20 },
]

function flatKlines(days, price = 100) {
  const out = []
  const start = new Date('2024-01-01')
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    out.push({ date: date.toISOString().slice(0, 10), close: price })
  }
  return out
}

function risingKlines(days, dailyGrowth = 0.001) {
  const out = []
  const start = new Date('2024-01-01')
  let close = 100
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    out.push({ date: date.toISOString().slice(0, 10), close })
    close *= 1 + dailyGrowth
  }
  return out
}

const approx = (actual, expected, tol) => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `期望 ${expected} ± ${tol}，实际 ${actual}`,
  )
}

test('样本不足 → currentAction = "样本不足"', () => {
  const klines = flatKlines(15)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  results.forEach((strategy) => {
    assert.equal(strategy.currentAction, '样本不足', `${strategy.name} 应该样本不足`)
    assert.equal(strategy.sampleSize, 15)
  })
})

test('买入持有 在平盘行情下 annualReturn ≈ 0、maxDrawdown = 0', () => {
  const klines = flatKlines(120)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const buyHold = results.find((s) => s.id === 'buyHold')
  assert.ok(buyHold)
  approx(buyHold.annualReturn, 0, 1e-9)
  approx(buyHold.maxDrawdown, 0, 1e-9)
  approx(buyHold.exposure, 1, 1e-9)
})

test('买入持有 在单调上涨行情下 annualReturn 与几何复利一致', () => {
  // 250 个交易日、每日 +0.1% → 总收益 (1.001)^249 - 1，年化 (1+总)^(252/249) - 1
  const days = 250
  const dailyGrowth = 0.001
  const klines = risingKlines(days, dailyGrowth)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const buyHold = results.find((s) => s.id === 'buyHold')

  const expectedTotal = (1 + dailyGrowth) ** (days - 1) - 1
  const expectedAnnual = (1 + expectedTotal) ** (252 / (days - 1)) - 1

  approx(buyHold.totalReturn, expectedTotal, 1e-9)
  approx(buyHold.annualReturn, expectedAnnual, 1e-9)
  approx(buyHold.maxDrawdown, 0, 1e-9)
})

test('回撤策略在持续上涨时几乎不出手 → exposure 较低', () => {
  const klines = risingKlines(250, 0.001)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const pullback = results.find((s) => s.id === 'pullback')
  // 没有 5%+ 回撤，exposure 期望接近 0
  assert.ok(pullback.exposure < 0.2, `期望低暴露，实际 ${pullback.exposure}`)
})

test('benchmarkAnnualReturn 等于 buyHold annualReturn', () => {
  const klines = risingKlines(250, 0.0008)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const buyHold = results.find((s) => s.id === 'buyHold')
  results.forEach((strategy) => {
    approx(strategy.benchmarkAnnualReturn, buyHold.annualReturn, 1e-9)
  })
})

test('所有策略输出 sampleSize 与输入一致', () => {
  const klines = risingKlines(120, 0.0005)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  results.forEach((strategy) => {
    assert.equal(strategy.sampleSize, 120)
  })
})
