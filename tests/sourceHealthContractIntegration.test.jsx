import { describe, expect, test } from 'vitest'
import { etfProfile, sourceHealthContract } from '../src/data/etf512400.js'
import { FRESHNESS } from '../src/data/sourceHealthContract.js'

describe('etf512400 source health contract integration', () => {
  test('暴露 sourceHealthContract 顶层 export 与 etfProfile.liveSnapshot 镜像', () => {
    expect(sourceHealthContract).toBeDefined()
    expect(Array.isArray(sourceHealthContract.entries)).toBe(true)
    expect(Object.values(FRESHNESS)).toContain(sourceHealthContract.freshness)
    expect(sourceHealthContract.counts).toEqual(
      expect.objectContaining({ fresh: expect.any(Number), recent: expect.any(Number), stale: expect.any(Number), missing: expect.any(Number) }),
    )
    expect(Array.isArray(sourceHealthContract.requiredMissing)).toBe(true)
    expect(etfProfile.liveSnapshot.sourceHealthContract).toBe(sourceHealthContract)
  })

  test('每个 contract 条目都符合公共字段约定', () => {
    for (const entry of sourceHealthContract.entries) {
      expect(typeof entry.sourceId).toBe('string')
      expect(typeof entry.label).toBe('string')
      expect(typeof entry.required).toBe('boolean')
      expect(typeof entry.ok).toBe('boolean')
      expect(typeof entry.fallback).toBe('boolean')
      expect(Object.values(FRESHNESS)).toContain(entry.freshness)
      expect(['ok', 'fallback', 'failed']).toContain(entry.status)
      expect(typeof entry.reason).toBe('string')
    }
  })

  test('counts 总和等于 entries 长度', () => {
    const { counts, entries } = sourceHealthContract
    const sum = counts.fresh + counts.recent + counts.stale + counts.missing
    expect(sum).toBe(entries.length)
  })
})
