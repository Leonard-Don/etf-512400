import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defineStrategySpec,
  serializeStrategySpec,
  deserializeStrategySpec,
} from '../src/analysis/strategySpec.js'

const validSpec = {
  id: 'trend-2060',
  name: '20/60 趋势',
  signal: {
    type: 'smaCross',
    params: { fastWindow: 20, slowWindow: 60 },
  },
  weights: {
    type: 'tiered',
    levels: [
      { when: 'trendOn', exposure: 1 },
      { when: 'priceAboveSlow', exposure: 0.55 },
      { when: 'belowSlow', exposure: 0 },
    ],
  },
  rebalance: { frequency: 'daily', minTradeDelta: 0 },
}

test('defineStrategySpec：合法输入返回冻结对象，包含 schemaVersion', () => {
  const spec = defineStrategySpec(validSpec)
  assert.equal(spec.id, 'trend-2060')
  assert.equal(spec.schemaVersion, 1)
  assert.equal(Object.isFrozen(spec), true)
  assert.equal(Object.isFrozen(spec.signal), true)
  assert.equal(Object.isFrozen(spec.weights), true)
  assert.equal(Object.isFrozen(spec.weights.levels), true)
})

test('defineStrategySpec：空 id 抛错，错误信息清晰', () => {
  assert.throws(
    () => defineStrategySpec({ ...validSpec, id: '' }),
    /StrategySpec\.id/,
  )
  assert.throws(
    () => defineStrategySpec({ ...validSpec, id: '   ' }),
    /StrategySpec\.id/,
  )
})

test('defineStrategySpec：缺少 signal 抛错', () => {
  assert.throws(() => defineStrategySpec({ ...validSpec, signal: undefined }), /signal/)
})

test('defineStrategySpec：signal.type 必须在已知集合内', () => {
  assert.throws(
    () => defineStrategySpec({ ...validSpec, signal: { type: 'magic', params: {} } }),
    /signal\.type/,
  )
})

test('defineStrategySpec：smaCross 必须 fastWindow < slowWindow 且皆为正整数', () => {
  assert.throws(
    () =>
      defineStrategySpec({
        ...validSpec,
        signal: { type: 'smaCross', params: { fastWindow: 60, slowWindow: 20 } },
      }),
    /fastWindow.*slowWindow|窗口/,
  )
  assert.throws(
    () =>
      defineStrategySpec({
        ...validSpec,
        signal: { type: 'smaCross', params: { fastWindow: 0, slowWindow: 60 } },
      }),
    /正整数|fastWindow/,
  )
  assert.throws(
    () =>
      defineStrategySpec({
        ...validSpec,
        signal: { type: 'smaCross', params: { fastWindow: 20, slowWindow: 60.5 } },
      }),
    /正整数|slowWindow/,
  )
})

test('defineStrategySpec：pullback signal 必须有递增档位', () => {
  assert.throws(
    () =>
      defineStrategySpec({
        ...validSpec,
        signal: { type: 'pullback', params: { tiers: [] } },
      }),
    /tiers/,
  )
  assert.throws(
    () =>
      defineStrategySpec({
        ...validSpec,
        signal: { type: 'pullback', params: { tiers: [0.1, 0.05] } },
      }),
    /递增|ascending/,
  )
})

test('defineStrategySpec：weights.levels 不能为空且 exposure 必须落在 [0,1]', () => {
  assert.throws(
    () => defineStrategySpec({ ...validSpec, weights: { type: 'tiered', levels: [] } }),
    /levels/,
  )
  assert.throws(
    () =>
      defineStrategySpec({
        ...validSpec,
        weights: {
          type: 'tiered',
          levels: [{ when: 'trendOn', exposure: 1.5 }],
        },
      }),
    /exposure/,
  )
  assert.throws(
    () =>
      defineStrategySpec({
        ...validSpec,
        weights: {
          type: 'tiered',
          levels: [{ when: 'trendOn', exposure: -0.1 }],
        },
      }),
    /exposure/,
  )
})

test('defineStrategySpec：rebalance.frequency 必须合法', () => {
  assert.throws(
    () =>
      defineStrategySpec({
        ...validSpec,
        rebalance: { frequency: 'hourly', minTradeDelta: 0 },
      }),
    /frequency/,
  )
})

test('defineStrategySpec：rebalance.minTradeDelta 必须 ∈ [0,1]', () => {
  assert.throws(
    () =>
      defineStrategySpec({
        ...validSpec,
        rebalance: { frequency: 'daily', minTradeDelta: -0.1 },
      }),
    /minTradeDelta/,
  )
  assert.throws(
    () =>
      defineStrategySpec({
        ...validSpec,
        rebalance: { frequency: 'daily', minTradeDelta: 2 },
      }),
    /minTradeDelta/,
  )
})

test('serializeStrategySpec：返回纯数据 JSON-safe，与 deserializeStrategySpec 互逆', () => {
  const spec = defineStrategySpec(validSpec)
  const json = serializeStrategySpec(spec)
  const text = JSON.stringify(json)
  const reparsed = JSON.parse(text)
  const rebuilt = deserializeStrategySpec(reparsed)
  assert.deepEqual(rebuilt, spec)
  // serialized form must not include functions or undefined
  assert.equal(typeof json, 'object')
  assert.equal(json.id, spec.id)
  assert.equal(json.schemaVersion, 1)
})

test('deserializeStrategySpec：拒绝错误 schemaVersion', () => {
  const json = { ...serializeStrategySpec(defineStrategySpec(validSpec)), schemaVersion: 99 }
  assert.throws(() => deserializeStrategySpec(json), /schemaVersion/)
})

test('defineStrategySpec：同一份输入两次构造结果深度相等（确定性）', () => {
  const a = defineStrategySpec(validSpec)
  const b = defineStrategySpec(validSpec)
  assert.deepEqual(a, b)
})

test('defineStrategySpec：输入对象被修改不会污染已生成的 spec（防御性深拷贝）', () => {
  const mutableInput = JSON.parse(JSON.stringify(validSpec))
  const spec = defineStrategySpec(mutableInput)
  mutableInput.id = 'mutated'
  mutableInput.weights.levels[0].exposure = 0.1
  assert.equal(spec.id, 'trend-2060')
  assert.equal(spec.weights.levels[0].exposure, 1)
})
