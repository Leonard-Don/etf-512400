import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDataFreshness,
  buildProviderFreshnessRegistry,
  calendarDayGap,
  describeMarketStatus,
  shanghaiDateString,
} from '../src/analysis/snapshotHealth.js'

const MAY_6_SHANGHAI = new Date('2026-05-06T04:00:00Z')

test('shanghaiDateString 使用 Asia/Shanghai 日期', () => {
  assert.equal(shanghaiDateString(MAY_6_SHANGHAI), '2026-05-06')
})

test('calendarDayGap 计算自然日差', () => {
  assert.equal(calendarDayGap('2026-04-30', '2026-05-06'), 6)
  assert.equal(calendarDayGap('2026-05-06', '2026-05-06'), 0)
})

test('calendarDayGap 对缺失或非法日期返回 null', () => {
  assert.equal(calendarDayGap('', '2026-05-06'), null)
  assert.equal(calendarDayGap('not-a-date', '2026-05-06'), null)
  assert.equal(calendarDayGap('2026-05-06', undefined), null)
})

test('describeMarketStatus 不再依赖固定休市文案', () => {
  assert.equal(
    describeMarketStatus({ quoteTradeDate: '2026-04-30', now: MAY_6_SHANGHAI }),
    '行情停留在 2026-04-30',
  )
  assert.equal(
    describeMarketStatus({ quoteTradeDate: '2026-05-06', now: MAY_6_SHANGHAI }),
    '今日行情已接入',
  )
})

test('buildDataFreshness 标出辅助源降级和缓存使用', () => {
  const result = buildDataFreshness({
    snapshotGeneratedAt: '2026-05-06T03:00:00.000Z',
    quoteTradeDate: '2026-05-06',
    navDate: '2026-05-06',
    now: MAY_6_SHANGHAI,
    sourceHealth: [
      { id: 'quote', label: 'ETF行情', required: true, ok: true },
      {
        id: 'fundGauge',
        label: '盘中估算净值',
        required: false,
        ok: false,
        fallback: true,
      },
    ],
  })
  assert.equal(result.status, 'partial')
  assert.equal(result.tone, 'warning')
  assert.equal(result.failedCount, 1)
  assert.equal(result.fallbackCount, 1)
  assert.equal(result.coverageScore, 50)
  assert.equal(result.stalenessBadge, '缓存兜底')
  assert.ok(result.details.includes('缓存源：盘中估算净值'))
})

test('buildDataFreshness 对无标签源使用 id 标注缓存和失败细节', () => {
  const result = buildDataFreshness({
    quoteTradeDate: '2026-05-06',
    navDate: '2026-05-06',
    now: MAY_6_SHANGHAI,
    sourceHealth: [
      {
        id: 'cacheOnlyQuote',
        required: false,
        ok: false,
        fallback: true,
      },
      {
        id: 'liveNav',
        required: false,
        ok: false,
        fallback: false,
      },
    ],
  })
  assert.equal(result.status, 'partial')
  assert.equal(result.failedCount, 2)
  assert.equal(result.fallbackCount, 1)
  assert.ok(result.details.includes('缓存源：cacheOnlyQuote'))
  assert.ok(result.details.includes('失败源：liveNav'))
})

test('buildDataFreshness 对核心源降级给出 danger', () => {
  const result = buildDataFreshness({
    quoteTradeDate: '2026-05-06',
    navDate: '2026-05-06',
    now: MAY_6_SHANGHAI,
    sourceHealth: [
      {
        id: 'quote',
        label: 'ETF行情',
        required: true,
        ok: false,
        fallback: true,
      },
    ],
  })
  assert.equal(result.status, 'degraded')
  assert.equal(result.tone, 'danger')
  assert.equal(result.requiredFailedCount, 1)
  assert.ok(result.details.includes('缓存源：ETF行情'))
})

test('buildDataFreshness 标出无缓存失败源名称', () => {
  const result = buildDataFreshness({
    quoteTradeDate: '2026-05-06',
    navDate: '2026-05-06',
    now: MAY_6_SHANGHAI,
    sourceHealth: [
      {
        id: 'runtimeQuote',
        label: '实时ETF行情',
        required: true,
        ok: false,
        fallback: false,
      },
    ],
  })
  assert.equal(result.status, 'degraded')
  assert.equal(result.tone, 'danger')
  assert.ok(result.details.includes('失败源：实时ETF行情'))
})

test('describeMarketStatus 在缺失行情日时给出未知文案', () => {
  assert.equal(describeMarketStatus({ now: MAY_6_SHANGHAI }), '行情日期未知')
  assert.equal(
    describeMarketStatus({ quoteTradeDate: '', now: MAY_6_SHANGHAI }),
    '行情日期未知',
  )
})

test('describeMarketStatus 区分今日待确认与上一交易日', () => {
  assert.equal(
    describeMarketStatus({
      quoteTradeDate: '2026-05-06',
      statusCode: 0,
      now: MAY_6_SHANGHAI,
    }),
    '今日行情待确认',
  )
  assert.equal(
    describeMarketStatus({ quoteTradeDate: '2026-05-05', now: MAY_6_SHANGHAI }),
    '行情停留在上一交易日',
  )
})

test('describeMarketStatus 对非法日期回退到原始字符串', () => {
  assert.equal(
    describeMarketStatus({ quoteTradeDate: 'invalid', now: MAY_6_SHANGHAI }),
    '行情日 invalid',
  )
})

test('buildDataFreshness 在数据齐备时返回 fresh 并附快照时间', () => {
  const result = buildDataFreshness({
    snapshotGeneratedAt: '2026-05-06T03:00:00.000Z',
    quoteTradeDate: '2026-05-06',
    navDate: '2026-05-06',
    now: MAY_6_SHANGHAI,
  })
  assert.equal(result.status, 'fresh')
  assert.equal(result.tone, 'good')
  assert.equal(result.summary, '数据已刷新')
  assert.equal(result.failedCount, 0)
  assert.equal(result.requiredFailedCount, 0)
  assert.equal(result.fallbackCount, 0)
  assert.equal(result.quoteAgeDays, 0)
  assert.equal(result.navAgeDays, 0)
  assert.equal(result.stalenessBadge, '新鲜')
  assert.equal(result.coverageScore, 100)
  assert.deepEqual(result.details, ['快照 2026-05-06T03:00:00.000Z'])
})

test('buildDataFreshness 对上一交易日数据返回 previous_trade_day', () => {
  const result = buildDataFreshness({
    quoteTradeDate: '2026-05-05',
    navDate: '2026-05-05',
    now: MAY_6_SHANGHAI,
  })
  assert.equal(result.status, 'previous_trade_day')
  assert.equal(result.tone, 'good')
  assert.equal(result.summary, '上一交易日数据')
  assert.equal(result.quoteAgeDays, 1)
  assert.equal(result.navAgeDays, 1)
  assert.ok(result.details.includes('行情距今天 1 天'))
  assert.ok(result.details.includes('净值距今天 1 天'))
})

test('buildDataFreshness 标记 stale 并写出行情和净值距今天数', () => {
  const result = buildDataFreshness({
    quoteTradeDate: '2026-04-30',
    navDate: '2026-04-29',
    now: MAY_6_SHANGHAI,
  })
  assert.equal(result.status, 'stale')
  assert.equal(result.tone, 'warning')
  assert.equal(result.summary, '行情停留在 2026-04-30')
  assert.equal(result.quoteAgeDays, 6)
  assert.equal(result.navAgeDays, 7)
  assert.ok(result.details.includes('行情距今天 6 天'))
  assert.ok(result.details.includes('净值距今天 7 天'))
})

test('buildDataFreshness 在缓存源缺标签时回退到数量描述', () => {
  const result = buildDataFreshness({
    quoteTradeDate: '2026-05-06',
    navDate: '2026-05-06',
    now: MAY_6_SHANGHAI,
    sourceHealth: [
      { ok: false, fallback: true, required: false },
      { ok: false, fallback: true, required: false },
    ],
  })
  assert.equal(result.status, 'partial')
  assert.equal(result.tone, 'warning')
  assert.equal(result.fallbackCount, 2)
  assert.ok(result.details.includes('2 个源使用缓存'))
})

test('buildProviderFreshnessRegistry 计算 provider 覆盖、fallback reason 与 staleness badge', () => {
  const result = buildProviderFreshnessRegistry({
    quoteTradeDate: '2026-05-06',
    navDate: '2026-05-06',
    snapshotGeneratedAt: '2026-05-06T03:00:00.000Z',
    now: MAY_6_SHANGHAI,
    sourceHealth: [
      {
        id: 'commodityDrivers',
        label: '商品驱动',
        ok: true,
        okCount: 4,
        total: 5,
      },
      {
        id: 'quote',
        label: 'ETF行情',
        required: true,
        ok: false,
        fallback: true,
        error: 'ECONNRESET',
      },
    ],
  })
  assert.equal(result.coverageScore, 40)
  assert.equal(result.failedRequiredCount, 1)
  assert.equal(result.stalenessBadge, '核心降级')
  assert.equal(result.providers[0].coveragePercent, 80)
  assert.equal(result.providers[1].badge, '缓存')
  assert.equal(result.providers[1].fallbackReason, 'ECONNRESET')
})

test('buildDataFreshness 对过旧 snapshot 给出 stale_snapshot 和过旧徽章', () => {
  const result = buildDataFreshness({
    snapshotGeneratedAt: '2026-05-01T03:00:00.000Z',
    quoteTradeDate: '2026-05-06',
    navDate: '2026-05-06',
    now: MAY_6_SHANGHAI,
    sourceHealth: [
      { id: 'etfKlines', label: '512400 日K', ok: true, fetchedAt: '2026-05-01T03:00:00.000Z' },
    ],
  })
  assert.equal(result.status, 'stale_snapshot')
  assert.equal(result.tone, 'warning')
  assert.equal(result.snapshotAgeDays, 5)
  assert.equal(result.stalenessBadge, '过旧')
  assert.ok(result.details.includes('快照距今天 5 天'))
  assert.equal(result.providerRegistry.providers[0].badge, '过旧')
})
