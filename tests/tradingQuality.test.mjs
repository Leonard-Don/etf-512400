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

test('样本不足（<20 日）→ tracking.status="样本不足"，tracking.score=null 不污染整体均值', () => {
  // 只给 15 日，对齐后 returns ≈14 个，低于 minSampleForGrading=20。
  // 与 PR #47/#48 对 premium.score 的修复对称：缺数据时 deviation20/60 与 trackingError60
  // 全部 null，旧路径 `Math.abs(null ?? 0)` 与 `null ?? defaultTrackingError` 让 rawScore
  // 退化成 ~73 的"假在范围内"分数，再被 finiteAverage 当作有效信号拉进整体 tradingQuality.score。
  // 修复后 tracking.score 应当像 premium.score 一样在样本不足时返回 null。
  const benchmark = syntheticSeries(15, (i) => 100 * 1.0005 ** i)
  const etf = syntheticSeries(15, (i) => 100 * 1.0005 ** i)
  const nav = navFromKlines(etf)
  const result = buildTradingQualityProfile({
    etfKlines: etf,
    benchmarkKlines: benchmark,
    navSeries: nav,
    price: etf.at(-1).close,
    nav: nav.at(-1).unit,
    quote: { amountCny: 100_000_000, turnoverRate: 0.01 },
  })
  assert.equal(result.tracking.status, '样本不足')
  assert.ok(result.tracking.sampleSize < 20)
  assert.equal(result.tracking.score, null)
  // 其它跟踪字段仍按真实数据返回（basis/deviations 等不受影响）
  assert.ok(['净值', '价格'].includes(result.tracking.basis))
  // 整体 tradingQuality.score 应当只反映可用维度（premium + liquidity），不掺入 tracking 假分
  assert.ok(Number.isFinite(result.premium.score))
  assert.ok(Number.isFinite(result.liquidity.score))
  assert.equal(
    result.score,
    Math.round((result.premium.score + result.liquidity.score) / 2),
  )
  assert.ok(result.score >= 0 && result.score <= 100)
})

test('价格相对净值低 ~2% → premium.status="折价偏深"，streakLabel 含"折价"', () => {
  // nav 单位定为 close * 1.02，使得 currentPremium ≈ -1.96%（<-0.4%）
  const klines = syntheticSeries(140, (i) => 100 * 1.0005 ** i)
  const nav = navFromKlines(klines, 1.02)
  const result = buildTradingQualityProfile({
    etfKlines: klines,
    benchmarkKlines: klines,
    navSeries: nav,
    price: klines.at(-1).close,
    nav: klines.at(-1).close * 1.02,
    quote: { amountCny: 500_000_000, turnoverRate: 0.02 },
  })
  assert.equal(result.premium.status, '折价偏深')
  assert.equal(result.premium.tone, 'opportunity')
  assert.ok(result.premium.currentPremium < -0.004)
  assert.match(result.premium.streakLabel, /折价/)
  assert.ok(result.premium.streak >= 1)
})

test('完全无成交额数据 → liquidity.status="样本不足"，amountPercentile 为 null，score 仍在 [0,100]', () => {
  // etf 仅有 close，没有 amount 字段；quote 也不带 amountCny
  const benchmark = syntheticSeries(140, (i) => 100)
  const etf = syntheticSeries(140, () => 100)
  const nav = navFromKlines(etf)
  const result = buildTradingQualityProfile({
    etfKlines: etf,
    benchmarkKlines: benchmark,
    navSeries: nav,
    price: 100,
    nav: 100,
    quote: { turnoverRate: 0.01 },
  })
  assert.equal(result.liquidity.status, '样本不足')
  assert.equal(result.liquidity.amountPercentile, null)
  assert.equal(result.liquidity.latestAmount, null)
  assert.ok(result.liquidity.score >= 0 && result.liquidity.score <= 100)
})

test('折溢价完全缺数据时 premium.score 应为 null，而不是被当作"零偏离=满分"', () => {
  // navSeries 为空 + nav 入参 undefined → currentPremium 既无法从入参算出，也无法从历史回退
  // 之前 `?? 0` fallback 会让 score = base(90)，把"没数据"伪装成"完美贴近净值"，
  // 拉高整体 tradingQuality.score。
  const benchmark = syntheticSeries(140, (i) => 100 * 1.0003 ** i)
  const etf = syntheticSeries(140, (i) => 100 * 1.0003 ** i)
  const result = buildTradingQualityProfile({
    etfKlines: etf,
    benchmarkKlines: benchmark,
    navSeries: [],
    price: etf.at(-1).close,
    nav: undefined,
    quote: { amountCny: 600_000_000, turnoverRate: 0.025 },
  })
  assert.equal(result.premium.status, '样本不足')
  assert.equal(result.premium.currentPremium, null)
  assert.equal(result.premium.score, null)
  // 整体分数仍可用：finiteAverage 会把 null 过滤掉
  assert.ok(Number.isFinite(result.score))
  assert.ok(result.score >= 0 && result.score <= 100)
})

test('currentPremium 恰好为数值 0（价格 = 净值）时 premium.score 仍接近基准 90', () => {
  // 真实的"贴近净值"必须保留高分，避免修复 null fallback 时误伤合法 0
  const klines = syntheticSeries(140, (i) => 100 * 1.0005 ** i)
  const nav = navFromKlines(klines)
  const result = buildTradingQualityProfile({
    etfKlines: klines,
    benchmarkKlines: klines,
    navSeries: nav,
    price: klines.at(-1).close,
    nav: klines.at(-1).close, // price === nav → currentPremium === 0
    quote: { amountCny: 500_000_000, turnoverRate: 0.02 },
  })
  assert.equal(result.premium.currentPremium, 0)
  assert.ok(Number.isFinite(result.premium.score))
  assert.ok(result.premium.score >= 85, `expected score near base 90, got ${result.premium.score}`)
})

test('真实 zScore=0（currentPremium 落在历史均值上、std20>0）→ premium.score 仍是高分有限值', () => {
  // 与上一条的差别：历史 premium 真正有波动（std20 不为 0），保证 zScore 是数值 0 而非 null。
  // 修复 `?? 0` → `Number.isFinite(...) ? ... : 0` 必须不动合法的数值 0。
  const days = 140
  const benchmark = syntheticSeries(days, () => 100)
  const etf = syntheticSeries(days, () => 100)
  // nav.unit 交替为 100.5/99.5，让历史 premium 在 0 附近正负摆动
  const nav = etf.map((item, i) => ({
    date: item.date,
    unit: i % 2 === 0 ? 100.5 : 99.5,
  }))
  const lastNavUnit = nav.at(-1).unit
  const result = buildTradingQualityProfile({
    etfKlines: etf,
    benchmarkKlines: benchmark,
    navSeries: nav,
    price: lastNavUnit,
    nav: lastNavUnit, // currentPremium === 0
    quote: { amountCny: 500_000_000, turnoverRate: 0.02 },
  })
  assert.equal(result.premium.currentPremium, 0)
  assert.ok(Number.isFinite(result.premium.zScore))
  assert.ok(Number.isFinite(result.premium.score))
  assert.ok(result.premium.score >= 0 && result.premium.score <= 100)
  assert.ok(
    ['贴近净值', '溢价偏热', '折价偏深'].includes(result.premium.status),
    `unexpected status ${result.premium.status}`,
  )
})

test('折溢价输入触发极端 zScore 时 premium.score 受 clamp 限制，status/streakLabel 仍是有效字符串', () => {
  // 构造：历史 premium 全部为 0（std20=0，原路径 zScore=null），currentPremium 突然偏离 +5%。
  // 这是"finite currentPremium + 内部 zScore 由 sanitize 兜底"的回归路径：
  // 即使把 `?? 0` 误改成漏 NaN/Infinity 的写法，整体输出也要落在 [0,100] 且 label 是字符串。
  const days = 140
  const benchmark = syntheticSeries(days, () => 100)
  const etf = syntheticSeries(days, () => 100)
  const nav = etf.map((item) => ({ date: item.date, unit: 100 }))
  const result = buildTradingQualityProfile({
    etfKlines: etf,
    benchmarkKlines: benchmark,
    navSeries: nav,
    price: 105,
    nav: 100, // currentPremium = +5%
    quote: { amountCny: 500_000_000, turnoverRate: 0.02 },
  })
  assert.ok(Number.isFinite(result.premium.currentPremium))
  assert.ok(Math.abs(result.premium.currentPremium - 0.05) < 1e-9)
  assert.ok(Number.isFinite(result.premium.score))
  assert.ok(result.premium.score >= 0 && result.premium.score <= 100)
  assert.ok(
    ['贴近净值', '溢价偏热', '折价偏深'].includes(result.premium.status),
    `unexpected status ${result.premium.status}`,
  )
  assert.equal(typeof result.premium.streakLabel, 'string')
  assert.doesNotMatch(result.premium.streakLabel, /NaN|Infinity/i)
  // 整体 tradingQuality.score 也应保持有限受限
  assert.ok(Number.isFinite(result.score))
  assert.ok(result.score >= 0 && result.score <= 100)
})
