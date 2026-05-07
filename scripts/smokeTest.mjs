import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildBacktestStrategies,
  buildSignalEngine,
  buildStrategyOptimizer,
  buildTradingQualityProfile,
  buildTrendProfile,
  calculateDailyChange,
  calculatePremium,
  composePrimaryDecision,
  composeResearchMemo,
} from '../src/analysis/metrics.js'

const snapshot = JSON.parse(await readFile(new URL('../src/data/liveSnapshot.json', import.meta.url), 'utf8'))

assert.equal(snapshot.quote?.code, '512400')
assert.ok(snapshot.etfKlines?.length >= 140, 'ETF K-line sample should support optimizer split')
assert.ok(snapshot.benchmarkKlines?.length >= 140, 'benchmark K-line sample should support tracking checks')
assert.ok(snapshot.navTrend?.length >= 140, 'NAV trend sample should support premium checks')
assert.ok(snapshot.commodityDrivers?.filter((driver) => driver.ok).length >= 3, 'commodity drivers should be mostly available')

const factorBaskets = [
  { name: '黄金链', weight: 19.54, trend: 25, risk: 95 },
  { name: '铜钼链', weight: 16.24, trend: 59, risk: 33 },
  { name: '稀土链', weight: 5.48, trend: 71, risk: 61 },
  { name: '铝链', weight: 7.03, trend: 48, risk: 95 },
  { name: '锂钴链', weight: 8.07, trend: 100, risk: 95 },
]

const trendProfile = buildTrendProfile(snapshot.etfKlines)
assert.equal(trendProfile.sampleSize, snapshot.etfKlines.length)
assert.ok(Number.isFinite(trendProfile.score), 'trend score should be finite')

const premium = calculatePremium(snapshot.quote.price, snapshot.nav.unit)
const dailyChange = calculateDailyChange(snapshot.quote.price, snapshot.quote.previousClose)
const signal = buildSignalEngine({
  premium,
  dailyChange,
  riskBudget: 48,
  factorBaskets,
  trendProfile,
  quote: snapshot.quote,
})
assert.ok(signal.action, 'signal action should exist')
assert.ok(signal.score >= 0 && signal.score <= 100, 'signal score should stay in range')

const strategies = buildBacktestStrategies({
  klines: snapshot.etfKlines,
  factorBaskets,
})
assert.ok(strategies.length >= 4, 'baseline strategies should be present')
assert.ok(strategies.every((strategy) => Number.isFinite(strategy.maxDrawdown)), 'backtest metrics should be finite')

const optimizer = buildStrategyOptimizer({
  klines: snapshot.etfKlines,
  factorBaskets,
})
assert.equal(optimizer.ok, true)
assert.ok(optimizer.best?.label, 'optimizer should return a best rule')
assert.ok(optimizer.best.stabilityScore >= 0 && optimizer.best.stabilityScore <= 100)

const tradingQuality = buildTradingQualityProfile({
  etfKlines: snapshot.etfKlines,
  benchmarkKlines: snapshot.benchmarkKlines,
  navSeries: snapshot.navTrend,
  price: snapshot.quote.price,
  nav: snapshot.nav.unit,
  quote: snapshot.quote,
})
assert.ok(tradingQuality.action, 'trading quality action should exist')
assert.ok(tradingQuality.score >= 0 && tradingQuality.score <= 100)
assert.ok(tradingQuality.tracking.sampleSize >= 20, 'tracking quality should align benchmark samples')
assert.ok(Number.isFinite(tradingQuality.premium.currentPremium), 'premium temperature should be finite')
assert.ok(
  tradingQuality.liquidity.amountPercentile >= 0 && tradingQuality.liquidity.amountPercentile <= 100,
  'liquidity percentile should stay in range',
)

const primaryDecision = composePrimaryDecision({
  signal,
  optimizer,
  riskBudget: 48,
  trendProfile,
})
assert.ok(primaryDecision.action, 'primary decision action should exist')
assert.ok(primaryDecision.exposure >= 0 && primaryDecision.exposure <= 0.48, 'primary exposure should respect risk budget cap')

const memo = composeResearchMemo({
  primaryDecision,
  signal,
  tradingQuality,
  trendProfile,
  premium,
  dailyChange,
})
const expectedExposurePercent = Math.round((primaryDecision.exposure ?? 0) * 100)
assert.ok(memo.headline.includes(primaryDecision.action), 'memo headline should carry the primary action')
assert.ok(memo.headline.includes(`${expectedExposurePercent}%`), 'memo headline should carry rounded exposure %')
assert.equal(memo.drivers.length, 3, 'memo should expose three driver lines (signal/quality/trend)')
assert.ok(memo.drivers.some((d) => d.includes(signal.action)), 'memo drivers should reflect signal action')
assert.ok(memo.drivers.some((d) => d.includes(tradingQuality.action)), 'memo drivers should reflect quality action')
assert.ok(memo.drivers.some((d) => d.includes(trendProfile.state)), 'memo drivers should reflect trend state')
assert.equal(
  memo.reasons.length,
  (signal.reasons?.length ?? 0) + (tradingQuality.watchPoints?.length ?? 0),
  'memo reasons should concatenate signal reasons + quality watch points',
)
assert.deepEqual(memo.invalidations, signal.invalidationRules ?? [], 'memo invalidations should mirror signal invalidationRules')
assert.equal(memo.metrics.score, primaryDecision.score, 'memo should expose primary decision score')
assert.equal(memo.metrics.exposure, primaryDecision.exposure, 'memo should expose primary decision exposure')
assert.ok(Number.isFinite(memo.metrics.confidence), 'memo confidence should be finite')
assert.ok(['positive', 'neutral', 'warning'].includes(memo.tone), 'memo tone should be a known severity')

console.log(
  [
    'smoke ok',
    `klines=${snapshot.etfKlines.length}`,
    `benchmark=${snapshot.benchmarkKlines.length}`,
    `signal=${signal.action}`,
    `optimizer=${optimizer.best.label}`,
    `quality=${tradingQuality.action}`,
    `memo=${primaryDecision.action}/${memo.drivers.length}drivers/${memo.reasons.length}reasons`,
  ].join(' | '),
)
