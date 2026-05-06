import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTradingQualityProfile } from '../src/analysis/tradingQuality.js'

function syntheticSeries(days, generator) {
  const out = []
  const start = new Date('2024-01-01')
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    out.push({ date: date.toISOString().slice(0, 10), close: generator(i) })
  }
  return out
}

function syntheticAmounts(days, generator) {
  const out = []
  const start = new Date('2024-01-01')
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    out.push({
      date: date.toISOString().slice(0, 10),
      close: 100,
      amount: generator(i),
    })
  }
  return out
}

function navFromKlines(klines, multiplier = 1) {
  return klines.map((item) => ({
    date: item.date,
    unit: item.close * multiplier,
  }))
}

test('ETF 跟踪基准时跟踪偏离接近 0、状态为"跟踪稳"', () => {
  // 让 etf 和 benchmark 几乎完全一致
  const benchmark = syntheticSeries(140, (i) => 100 * 1.0005 ** i)
  const etf = syntheticSeries(140, (i) => 100 * 1.0005 ** i)
  const nav = navFromKlines(etf)
  const result = buildTradingQualityProfile({
    etfKlines: etf,
    benchmarkKlines: benchmark,
    navSeries: nav,
    price: etf.at(-1).close,
    nav: nav.at(-1).unit,
    quote: { amountCny: 800_000_000, turnoverRate: 0.03 },
  })
  assert.ok(['跟踪稳', '可接受'].includes(result.tracking.status))
  assert.ok(Math.abs(result.tracking.deviation20 ?? 0) < 0.005)
  assert.ok(result.score >= 0 && result.score <= 100)
})

test('折溢价偏热（价格 vs 净值偏离 +1.5%）→ premium.status 为"溢价偏热"', () => {
  const klines = syntheticSeries(140, (i) => 100 * 1.0005 ** i)
  const nav = navFromKlines(klines)
  const result = buildTradingQualityProfile({
    etfKlines: klines,
    benchmarkKlines: klines,
    navSeries: nav,
    price: klines.at(-1).close * 1.015,
    nav: nav.at(-1).unit,
    quote: { amountCny: 500_000_000, turnoverRate: 0.02 },
  })
  assert.equal(result.premium.status, '溢价偏热')
  assert.equal(result.premium.tone, 'warning')
})

test('成交额收缩 → liquidity.status 为"成交收缩"', () => {
  // 前 100 日成交活跃，最近 20 日骤降
  const benchmark = syntheticSeries(140, (i) => 100)
  const etf = syntheticAmounts(140, (i) => (i < 100 ? 1_000_000_000 : 100_000_000))
  const nav = navFromKlines(etf)
  const result = buildTradingQualityProfile({
    etfKlines: etf,
    benchmarkKlines: benchmark,
    navSeries: nav,
    price: 100,
    nav: 100,
    quote: { amountCny: 80_000_000, turnoverRate: 0.005 },
  })
  assert.equal(result.liquidity.status, '成交收缩')
})

test('整体输出关键字段都在合理范围', () => {
  const benchmark = syntheticSeries(140, (i) => 100 * 1.0003 ** i)
  const etf = syntheticSeries(140, (i) => 100 * 1.0003 ** i)
  const nav = navFromKlines(etf)
  const result = buildTradingQualityProfile({
    etfKlines: etf,
    benchmarkKlines: benchmark,
    navSeries: nav,
    price: etf.at(-1).close,
    nav: nav.at(-1).unit,
    quote: { amountCny: 600_000_000, turnoverRate: 0.025 },
  })
  assert.ok(result.score >= 0 && result.score <= 100)
  assert.ok(result.tracking.score >= 0 && result.tracking.score <= 100)
  assert.ok(result.premium.score >= 0 && result.premium.score <= 100)
  assert.ok(result.liquidity.score >= 0 && result.liquidity.score <= 100)
  assert.equal(result.watchPoints.length, 3)
  assert.match(result.tracking.basis, /净值|价格/)
})

test('净值缺失时回退到价格口径', () => {
  const benchmark = syntheticSeries(140, (i) => 100 * 1.0003 ** i)
  const etf = syntheticSeries(140, (i) => 100 * 1.0003 ** i)
  // 净值序列空 → 应走价格口径
  const result = buildTradingQualityProfile({
    etfKlines: etf,
    benchmarkKlines: benchmark,
    navSeries: [],
    price: etf.at(-1).close,
    nav: undefined,
    quote: { amountCny: 600_000_000, turnoverRate: 0.025 },
  })
  assert.equal(result.tracking.basis, '价格')
})

test('quote 缺 amountCny 时不会爆掉，liquidity 仍能给分位/分数', () => {
  const benchmark = syntheticSeries(140, (i) => 100)
  const etf = syntheticAmounts(140, () => 500_000_000)
  const nav = navFromKlines(etf)
  const result = buildTradingQualityProfile({
    etfKlines: etf,
    benchmarkKlines: benchmark,
    navSeries: nav,
    price: 100,
    nav: 100,
    quote: {},
  })
  assert.ok(Number.isFinite(result.liquidity.score))
  assert.ok(
    result.liquidity.amountPercentile === null ||
      (result.liquidity.amountPercentile >= 0 && result.liquidity.amountPercentile <= 100),
  )
})
