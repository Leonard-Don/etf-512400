import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parameterGrid } from '../src/analysis/parameterGrid.js'

test('parameterGrid：合法 axes 生成所有组合', () => {
  const grid = parameterGrid({
    fastWindow: [10, 20],
    slowWindow: [60, 120],
  })
  assert.equal(grid.size, 4)
  assert.equal(grid.axisCount, 2)
  assert.deepEqual(grid.combinations, [
    { fastWindow: 10, slowWindow: 60 },
    { fastWindow: 10, slowWindow: 120 },
    { fastWindow: 20, slowWindow: 60 },
    { fastWindow: 20, slowWindow: 120 },
  ])
})

test('parameterGrid：相同 axes 不同顺序输入，输出仍然确定（key 字典序）', () => {
  const a = parameterGrid({
    fastWindow: [10, 20],
    slowWindow: [60, 120],
  })
  const b = parameterGrid({
    slowWindow: [120, 60],
    fastWindow: [20, 10],
  })
  assert.deepEqual(a.combinations, b.combinations)
  assert.deepEqual(a.axisNames, b.axisNames)
})

test('parameterGrid：axis 值升序排列且去重', () => {
  const grid = parameterGrid({
    fastWindow: [20, 10, 20, 10, 15],
  })
  assert.deepEqual(
    grid.combinations.map((combo) => combo.fastWindow),
    [10, 15, 20],
  )
})

test('parameterGrid：空 axes 抛错', () => {
  assert.throws(() => parameterGrid({}), /至少一个 axis|axis/)
})

test('parameterGrid：axis 为空数组抛错', () => {
  assert.throws(() => parameterGrid({ fastWindow: [] }), /fastWindow.*空|empty/)
})

test('parameterGrid：包含 NaN/Infinity 时按选项决定剔除或抛错', () => {
  assert.throws(
    () => parameterGrid({ fastWindow: [10, NaN] }, { onInvalid: 'throw' }),
    /fastWindow.*NaN|invalid/i,
  )
  const grid = parameterGrid({ fastWindow: [10, NaN, Infinity, 20] }, { onInvalid: 'skip' })
  assert.deepEqual(
    grid.combinations.map((combo) => combo.fastWindow),
    [10, 20],
  )
  assert.ok(grid.warnings.some((warning) => warning.includes('fastWindow')))
})

test('parameterGrid：onInvalid 默认 throw', () => {
  assert.throws(() => parameterGrid({ fastWindow: [10, NaN] }), /NaN|invalid/i)
})

test('parameterGrid：filter 过滤无效组合（return false）', () => {
  const grid = parameterGrid(
    {
      fastWindow: [10, 20],
      slowWindow: [50, 60],
    },
    { filter: (combo) => combo.slowWindow > combo.fastWindow + 35 },
  )
  // 10/50(50>45 ✓), 10/60(60>45 ✓), 20/50(50>55 ✗), 20/60(60>55 ✓)
  assert.deepEqual(grid.combinations, [
    { fastWindow: 10, slowWindow: 50 },
    { fastWindow: 10, slowWindow: 60 },
    { fastWindow: 20, slowWindow: 60 },
  ])
  assert.equal(grid.size, 3)
  assert.equal(grid.rejectedByFilter, 1)
})

test('parameterGrid：filter 全部拒绝 → size 0 且带 warning', () => {
  const grid = parameterGrid(
    { fastWindow: [10, 20] },
    { filter: () => false },
  )
  assert.equal(grid.size, 0)
  assert.equal(grid.rejectedByFilter, 2)
  assert.ok(grid.warnings.some((warning) => warning.includes('全部')))
})

test('parameterGrid：filter 非函数抛 TypeError', () => {
  assert.throws(
    () => parameterGrid({ fastWindow: [10] }, { filter: 'not-a-fn' }),
    /filter.*function/i,
  )
})

test('parameterGrid：组合对象 frozen，axisNames 升序', () => {
  const grid = parameterGrid({
    zParam: [1],
    aParam: [2],
    mParam: [3],
  })
  assert.deepEqual(grid.axisNames, ['aParam', 'mParam', 'zParam'])
  assert.equal(Object.isFrozen(grid.combinations[0]), true)
})

test('parameterGrid：iterate() 与 combinations 顺序一致', () => {
  const grid = parameterGrid({
    fastWindow: [10, 20],
    slowWindow: [60],
  })
  const iterated = [...grid.iterate()]
  assert.deepEqual(iterated, grid.combinations)
})

test('parameterGrid：toJSON 返回纯数据', () => {
  const grid = parameterGrid({ fastWindow: [10, 20] })
  const json = grid.toJSON()
  const text = JSON.stringify(json)
  const reparsed = JSON.parse(text)
  assert.deepEqual(reparsed.combinations, grid.combinations)
  assert.deepEqual(reparsed.axisNames, ['fastWindow'])
  assert.equal(reparsed.size, 2)
})

test('parameterGrid：null/undefined axes 抛错', () => {
  assert.throws(() => parameterGrid(null), /axes|对象/)
  assert.throws(() => parameterGrid(undefined), /axes|对象/)
})

test('parameterGrid：单一 axis 单值返回长度 1', () => {
  const grid = parameterGrid({ fastWindow: [10] })
  assert.equal(grid.size, 1)
  assert.deepEqual(grid.combinations, [{ fastWindow: 10 }])
})

test('parameterGrid：字符串 axis 值原样保留并按字典序排序', () => {
  const grid = parameterGrid({ regime: ['risk-off', 'neutral', 'risk-on'] })
  assert.deepEqual(
    grid.combinations.map((combo) => combo.regime),
    ['neutral', 'risk-off', 'risk-on'],
  )
})
