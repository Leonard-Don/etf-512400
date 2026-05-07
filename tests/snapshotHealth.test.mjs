import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDataFreshness,
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
