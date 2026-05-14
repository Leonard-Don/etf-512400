import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FRESHNESS,
  DEFAULT_THRESHOLDS_MS,
  normalizeSourceEntry,
  summarizeSourceHealth,
} from '../src/data/sourceHealthContract.js'

const NOW = new Date('2026-05-06T04:00:00Z')
const HOUR = 60 * 60 * 1000

test('FRESHNESS 暴露枚举常量供调用方做 switch', () => {
  assert.deepEqual(
    Object.values(FRESHNESS).sort(),
    ['fresh', 'missing', 'recent', 'stale'],
  )
})

test('DEFAULT_THRESHOLDS_MS 暴露 fresh/stale 边界且 fresh < stale', () => {
  assert.ok(Number.isFinite(DEFAULT_THRESHOLDS_MS.fresh))
  assert.ok(Number.isFinite(DEFAULT_THRESHOLDS_MS.stale))
  assert.ok(DEFAULT_THRESHOLDS_MS.fresh < DEFAULT_THRESHOLDS_MS.stale)
})

test('normalizeSourceEntry 把刚刷新的 ISO asOf 标为 fresh', () => {
  const entry = normalizeSourceEntry(
    { id: 'quote', label: 'ETF行情', required: true, ok: true, asOf: '2026-05-06T03:30:00Z' },
    { now: NOW },
  )
  assert.equal(entry.sourceId, 'quote')
  assert.equal(entry.label, 'ETF行情')
  assert.equal(entry.required, true)
  assert.equal(entry.ok, true)
  assert.equal(entry.fallback, false)
  assert.equal(entry.freshness, FRESHNESS.FRESH)
  assert.equal(entry.reason, 'ok')
  assert.equal(entry.status, 'ok')
  assert.equal(entry.asOf, '2026-05-06T03:30:00.000Z')
  assert.equal(entry.ageMs, 30 * 60 * 1000)
})

test('normalizeSourceEntry 把 fresh 与 stale 之间的 asOf 标为 recent', () => {
  const entry = normalizeSourceEntry(
    { id: 'fundTrend', asOf: new Date(NOW.getTime() - 36 * HOUR).toISOString() },
    { now: NOW },
  )
  assert.equal(entry.freshness, FRESHNESS.RECENT)
  assert.equal(entry.reason, 'ok')
})

test('normalizeSourceEntry 超过 stale 阈值时标为 stale 并给出 stale-age 原因', () => {
  const entry = normalizeSourceEntry(
    { id: 'macro', asOf: new Date(NOW.getTime() - 10 * 24 * HOUR).toISOString() },
    { now: NOW },
  )
  assert.equal(entry.freshness, FRESHNESS.STALE)
  assert.equal(entry.reason, 'stale-age')
  assert.equal(entry.ageMs, 10 * 24 * HOUR)
})

test('normalizeSourceEntry 缺失 asOf 时给出 missing 与 missing-timestamp 原因', () => {
  const entry = normalizeSourceEntry({ id: 'fundGauge', ok: true }, { now: NOW })
  assert.equal(entry.freshness, FRESHNESS.MISSING)
  assert.equal(entry.reason, 'missing-timestamp')
  assert.equal(entry.ageMs, null)
  assert.equal(entry.asOf, null)
})

test('normalizeSourceEntry 对非法时间字符串给出 invalid-timestamp', () => {
  const entry = normalizeSourceEntry(
    { id: 'commodity', asOf: 'not-a-date', ok: true },
    { now: NOW },
  )
  assert.equal(entry.freshness, FRESHNESS.MISSING)
  assert.equal(entry.reason, 'invalid-timestamp')
  assert.equal(entry.ageMs, null)
  assert.equal(entry.asOf, null)
})

test('normalizeSourceEntry 接受多种 asOf 输入（Date / number / asOfDate 日历串）', () => {
  const fromDate = normalizeSourceEntry(
    { id: 'a', asOf: new Date(NOW.getTime() - HOUR) },
    { now: NOW },
  )
  assert.equal(fromDate.freshness, FRESHNESS.FRESH)
  assert.equal(fromDate.ageMs, HOUR)

  const fromNumber = normalizeSourceEntry(
    { id: 'b', asOf: NOW.getTime() - 2 * HOUR },
    { now: NOW },
  )
  assert.equal(fromNumber.freshness, FRESHNESS.FRESH)
  assert.equal(fromNumber.ageMs, 2 * HOUR)

  const fromCalendar = normalizeSourceEntry(
    { id: 'c', asOfDate: '2026-05-06' },
    { now: NOW },
  )
  assert.equal(fromCalendar.freshness, FRESHNESS.FRESH)
  assert.equal(fromCalendar.ageMs, 4 * HOUR)
  assert.equal(fromCalendar.asOf, '2026-05-06T00:00:00.000Z')

  const fromPriorDate = normalizeSourceEntry(
    { id: 'd', asOfDate: '2026-05-05' },
    { now: NOW },
  )
  assert.equal(fromPriorDate.freshness, FRESHNESS.RECENT)
})

test('normalizeSourceEntry 在 fallback=true 时把 status/reason 标为 fallback', () => {
  const entry = normalizeSourceEntry(
    {
      id: 'fundGauge',
      label: '盘中估算净值',
      ok: false,
      fallback: true,
      asOf: '2026-05-06T03:30:00Z',
    },
    { now: NOW },
  )
  assert.equal(entry.status, 'fallback')
  assert.equal(entry.reason, 'fallback')
  assert.equal(entry.fallback, true)
  assert.equal(entry.ok, false)
  assert.equal(entry.freshness, FRESHNESS.FRESH)
})

test('normalizeSourceEntry 对 required 源失败且无 fallback 时标 required-failure', () => {
  const entry = normalizeSourceEntry(
    { id: 'quote', label: 'ETF行情', required: true, ok: false, asOf: '2026-05-06T03:30:00Z' },
    { now: NOW },
  )
  assert.equal(entry.status, 'failed')
  assert.equal(entry.reason, 'required-failure')
})

test('normalizeSourceEntry 对辅助源失败且无 fallback 时标 source-error', () => {
  const entry = normalizeSourceEntry(
    { id: 'macro', required: false, ok: false, asOf: '2026-05-06T03:30:00Z' },
    { now: NOW },
  )
  assert.equal(entry.status, 'failed')
  assert.equal(entry.reason, 'source-error')
})

test('normalizeSourceEntry 在 id 和 label 都缺失时回退为 unknown', () => {
  const entry = normalizeSourceEntry({}, { now: NOW })
  assert.equal(entry.sourceId, 'unknown')
  assert.equal(entry.label, 'unknown')
})

test('normalizeSourceEntry 在仅有 label 时把 sourceId 推导为 label', () => {
  const entry = normalizeSourceEntry({ label: '宏观利率', asOf: NOW }, { now: NOW })
  assert.equal(entry.sourceId, '宏观利率')
  assert.equal(entry.label, '宏观利率')
})

test('normalizeSourceEntry 支持自定义阈值', () => {
  const entry = normalizeSourceEntry(
    { id: 'tight', asOf: new Date(NOW.getTime() - 2 * HOUR).toISOString() },
    { now: NOW, thresholds: { fresh: HOUR, stale: 3 * HOUR } },
  )
  assert.equal(entry.freshness, FRESHNESS.RECENT)
})

test('summarizeSourceHealth 空集合返回 missing 与全零计数', () => {
  const summary = summarizeSourceHealth([], { now: NOW })
  assert.equal(summary.freshness, FRESHNESS.MISSING)
  assert.deepEqual(summary.counts, { fresh: 0, recent: 0, stale: 0, missing: 0 })
  assert.deepEqual(summary.requiredMissing, [])
  assert.deepEqual(summary.entries, [])
})

test('summarizeSourceHealth 最差档位胜出（stale > recent > fresh）', () => {
  const summary = summarizeSourceHealth(
    [
      { id: 'a', asOf: NOW.toISOString() },
      { id: 'b', asOf: new Date(NOW.getTime() - 36 * HOUR).toISOString() },
    ],
    { now: NOW },
  )
  assert.equal(summary.freshness, FRESHNESS.RECENT)
  assert.deepEqual(summary.counts, { fresh: 1, recent: 1, stale: 0, missing: 0 })
})

test('summarizeSourceHealth 列出核心源缺失且无 fallback 的条目', () => {
  const summary = summarizeSourceHealth(
    [
      { id: 'quote', label: 'ETF行情', required: true, ok: false, asOf: NOW.toISOString() },
      {
        id: 'fundGauge',
        label: '估算净值',
        required: false,
        ok: false,
        fallback: true,
        asOf: NOW.toISOString(),
      },
    ],
    { now: NOW },
  )
  assert.equal(summary.requiredMissing.length, 1)
  assert.equal(summary.requiredMissing[0].sourceId, 'quote')
  assert.equal(summary.requiredMissing[0].reason, 'required-failure')
})

test('summarizeSourceHealth 把 missing 计入 stale 严重度（worst-wins）', () => {
  const summary = summarizeSourceHealth(
    [
      { id: 'a', asOf: NOW.toISOString() },
      { id: 'b' },
    ],
    { now: NOW },
  )
  assert.equal(summary.freshness, FRESHNESS.STALE)
  assert.deepEqual(summary.counts, { fresh: 1, recent: 0, stale: 0, missing: 1 })
})
