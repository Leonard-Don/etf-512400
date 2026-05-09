import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeHistoryArchive,
  normalizeHistorySnapshot,
} from '../src/analysis/historyArchive.js'

const SAMPLE_RECORD = {
  generatedAt: '2026-05-06T06:29:39.104Z',
  tradeDate: '2026-04-30',
  tradeTime: '2026-04-30 16:11:58',
  price: 2.119,
  nav: 2.117,
  premium: 0.0009447331128957792,
  changePercent: -0.0098,
  amountCny: 807395293,
  turnoverRate: 0.0287,
  drivers: [
    { key: 'gold', ok: true, price: 1027.92, changePercent: 0.0222, trendScore: 32, riskScore: 95 },
    { key: 'copper', ok: true, price: 102850, changePercent: 0.0175, trendScore: 69, riskScore: 34 },
    { key: 'aluminum', ok: true, price: 24755, changePercent: 0.0129, trendScore: 46, riskScore: 95 },
    { key: 'battery', ok: true, price: 198120, changePercent: 0.0662, trendScore: 100, riskScore: 95 },
    { key: 'rareEarth', ok: true, price: 3235.62, changePercent: 0.03, trendScore: 87, riskScore: 62 },
  ],
}

test('normalizeHistorySnapshot 提取日期与行情字段', () => {
  const entry = normalizeHistorySnapshot(SAMPLE_RECORD)
  assert.equal(entry.date, '2026-04-30')
  assert.equal(entry.generatedAt, '2026-05-06T06:29:39.104Z')
  assert.equal(entry.quote.price, 2.119)
  assert.equal(entry.quote.nav, 2.117)
  assert.equal(entry.quote.changePercent, -0.0098)
  assert.equal(entry.quote.amountCny, 807395293)
  assert.equal(entry.quote.turnoverRate, 0.0287)
  assert.equal(entry.quote.tradeTime, '2026-04-30 16:11:58')
})

test('normalizeHistorySnapshot 保留折溢价并按驱动构建信号聚合', () => {
  const entry = normalizeHistorySnapshot(SAMPLE_RECORD)
  assert.equal(entry.premium, 0.0009447331128957792)
  // (32+69+46+100+87)/5 = 66.8
  assert.equal(entry.signal.avgTrend, 66.8)
  // (95+34+95+95+62)/5 = 76.2
  assert.equal(entry.signal.avgRisk, 76.2)
  assert.equal(entry.signal.driverCount, 5)
  // 风险分 ≥80 的驱动：gold/aluminum/battery 共 3 个
  assert.equal(entry.signal.highRiskCount, 3)
  assert.equal(entry.signal.positiveCount, 3)
})

test('normalizeHistorySnapshot 高风险驱动 ≥3 时压成风险降档与低仓位', () => {
  const entry = normalizeHistorySnapshot(SAMPLE_RECORD)
  assert.equal(entry.decision.action, '风险降档')
  assert.equal(entry.decision.tone, 'warning')
  assert.equal(entry.exposure, 0.1)
  assert.equal(entry.risk.tone, 'danger')
  assert.equal(entry.risk.topDriver.key, 'gold')
  assert.equal(entry.risk.topDriver.riskScore, 95)
})

test('normalizeHistorySnapshot 折溢价超阈值触发禁止追高', () => {
  const entry = normalizeHistorySnapshot({
    ...SAMPLE_RECORD,
    premium: 0.012,
    drivers: [
      { key: 'gold', ok: true, trendScore: 80, riskScore: 50 },
      { key: 'copper', ok: true, trendScore: 70, riskScore: 40 },
    ],
  })
  assert.equal(entry.decision.action, '禁止追高')
  assert.equal(entry.decision.tone, 'warning')
  assert.equal(entry.exposure, 0.05)
})

test('normalizeHistorySnapshot 低风险且趋势好时给出加仓', () => {
  const entry = normalizeHistorySnapshot({
    ...SAMPLE_RECORD,
    premium: 0.001,
    drivers: [
      { key: 'gold', ok: true, trendScore: 80, riskScore: 40 },
      { key: 'copper', ok: true, trendScore: 75, riskScore: 35 },
      { key: 'rareEarth', ok: true, trendScore: 70, riskScore: 30 },
    ],
  })
  assert.equal(entry.decision.action, '分批加仓')
  assert.equal(entry.decision.tone, 'positive')
  assert.equal(entry.exposure, 0.6)
  assert.equal(entry.risk.tone, 'good')
})

test('normalizeHistorySnapshot 中性趋势给小仓跟踪', () => {
  const entry = normalizeHistorySnapshot({
    ...SAMPLE_RECORD,
    premium: 0.001,
    drivers: [
      { key: 'gold', ok: true, trendScore: 60, riskScore: 50 },
      { key: 'copper', ok: true, trendScore: 55, riskScore: 45 },
    ],
  })
  assert.equal(entry.decision.action, '小仓跟踪')
  assert.equal(entry.decision.tone, 'positive')
  assert.equal(entry.exposure, 0.4)
})

test('normalizeHistorySnapshot 趋势疲弱回落到等待状态', () => {
  const entry = normalizeHistorySnapshot({
    ...SAMPLE_RECORD,
    premium: 0.001,
    drivers: [
      { key: 'gold', ok: true, trendScore: 30, riskScore: 50 },
      { key: 'copper', ok: true, trendScore: 35, riskScore: 45 },
    ],
  })
  assert.equal(entry.decision.action, '等待回落')
  assert.equal(entry.decision.tone, 'neutral')
  assert.equal(entry.exposure, 0.2)
})

test('normalizeHistorySnapshot 忽略 ok=false 的驱动', () => {
  const entry = normalizeHistorySnapshot({
    ...SAMPLE_RECORD,
    premium: 0.001,
    drivers: [
      { key: 'gold', ok: false, trendScore: 99, riskScore: 99 },
      { key: 'copper', ok: true, trendScore: 70, riskScore: 30 },
      { key: 'rareEarth', ok: true, trendScore: 80, riskScore: 20 },
    ],
  })
  assert.equal(entry.signal.driverCount, 2)
  assert.equal(entry.signal.avgTrend, 75)
  assert.equal(entry.signal.avgRisk, 25)
  assert.equal(entry.signal.highRiskCount, 0)
})

test('normalizeHistorySnapshot 把非有限风险分按零风险纳入均值', () => {
  const entry = normalizeHistorySnapshot({
    ...SAMPLE_RECORD,
    premium: 0.001,
    drivers: [
      { key: 'gold', ok: true, trendScore: 70, riskScore: Number.NaN },
      { key: 'copper', ok: true, trendScore: 80, riskScore: 40 },
    ],
  })
  assert.equal(entry.signal.driverCount, 2)
  assert.equal(entry.signal.avgTrend, 75)
  assert.equal(entry.signal.avgRisk, 20)
  assert.equal(entry.signal.highRiskCount, 0)
})

test('normalizeHistorySnapshot 对 null 或缺失输入返回 null', () => {
  assert.equal(normalizeHistorySnapshot(null), null)
  assert.equal(normalizeHistorySnapshot(undefined), null)
  assert.equal(normalizeHistorySnapshot({}), null)
})

test('normalizeHistorySnapshot 空字符串 tradeDate 视为缺失日期返回 null', () => {
  assert.equal(normalizeHistorySnapshot({ ...SAMPLE_RECORD, tradeDate: '' }), null)
})

test('normalizeHistorySnapshot 缺驱动数组时仍可计算（信号视为零驱动）', () => {
  const entry = normalizeHistorySnapshot({
    tradeDate: '2026-04-29',
    price: 2.0,
    nav: 1.99,
    premium: 0.005,
  })
  assert.equal(entry.date, '2026-04-29')
  assert.equal(entry.signal.driverCount, 0)
  assert.equal(entry.signal.avgTrend, 0)
  assert.equal(entry.signal.avgRisk, 0)
  assert.equal(entry.signal.highRiskCount, 0)
  assert.equal(entry.risk.tone, 'good')
  assert.equal(entry.risk.topDriver, null)
})

test('normalizeHistoryArchive 接受非数组输入并返回空数组', () => {
  assert.deepEqual(normalizeHistoryArchive(null), [])
  assert.deepEqual(normalizeHistoryArchive(undefined), [])
  assert.deepEqual(normalizeHistoryArchive({}), [])
})

test('normalizeHistoryArchive 按日期降序排列并过滤无效条目', () => {
  const result = normalizeHistoryArchive([
    { ...SAMPLE_RECORD, tradeDate: '2026-04-29' },
    null,
    { ...SAMPLE_RECORD, tradeDate: '2026-04-30' },
    {},
    { ...SAMPLE_RECORD, tradeDate: '2026-04-28' },
  ])
  assert.equal(result.length, 3)
  assert.deepEqual(
    result.map((entry) => entry.date),
    ['2026-04-30', '2026-04-29', '2026-04-28'],
  )
})
