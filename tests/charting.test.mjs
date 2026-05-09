import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapSeriesToPolyline } from '../src/analysis/charting.js'

test('正常序列产出 N 个 "x,y" 坐标对', () => {
  const series = [
    { date: '2024-01', etf: 1.0 },
    { date: '2024-02', etf: 1.2 },
    { date: '2024-03', etf: 0.9 },
  ]
  const points = mapSeriesToPolyline(series, 'etf', 100, 50).split(' ')
  assert.equal(points.length, 3)
  points.forEach((point) => assert.match(point, /^\d+\.\d+,\d+\.\d+$/))
})

test('空序列返回空字符串', () => {
  assert.equal(mapSeriesToPolyline([], 'etf'), '')
})

test('全部缺失返回空字符串（不抛出）', () => {
  const series = [{ date: '2024-01' }, { date: '2024-02' }]
  assert.equal(mapSeriesToPolyline(series, 'etf'), '')
})

test('部分缺失：缺失点被跳过，其它点仍正常映射', () => {
  const series = [
    { date: '2024-01', etf: 1 },
    { date: '2024-02' }, // 缺失
    { date: '2024-03', etf: 2 },
    { date: '2024-04', etf: 1.5 },
  ]
  const result = mapSeriesToPolyline(series, 'etf', 100, 50)
  const points = result.split(' ')
  // 缺失点被过滤后剩 3 点
  assert.equal(points.length, 3)
})

test('全部相同值时不会除零（span fallback 到 1）', () => {
  const series = [
    { date: '2024-01', etf: 1 },
    { date: '2024-02', etf: 1 },
  ]
  const result = mapSeriesToPolyline(series, 'etf', 100, 50)
  // 应当稳定输出而非 NaN
  assert.match(result, /^\d+\.\d+,\d+\.\d+ \d+\.\d+,\d+\.\d+$/)
  assert.ok(!result.includes('NaN'))
})

test('单点序列：xStep 退化但仍能输出', () => {
  const series = [{ date: '2024-01', etf: 1 }]
  const result = mapSeriesToPolyline(series, 'etf', 100, 50)
  // 单点不会产生 polyline，但实现允许返回单个坐标
  assert.match(result, /^\d+\.\d+,\d+\.\d+$/)
})

test('null/undefined 入参不抛出', () => {
  assert.equal(mapSeriesToPolyline(null, 'etf'), '')
  assert.equal(mapSeriesToPolyline(undefined, 'etf'), '')
})

test('最小值映射到底部 (y=height)，最大值映射到顶部 (y=0)', () => {
  const series = [
    { date: '2024-01', etf: 0 },
    { date: '2024-02', etf: 10 },
  ]
  const result = mapSeriesToPolyline(series, 'etf', 100, 50)
  // 第一个点 = min = 0 → y = height
  // 第二个点 = max = 10 → y = 0
  assert.equal(result, '0.00,50.00 100.00,0.00')
})

test('负值范围被正确归一化（min→底部，0 → 中间，max→顶部）', () => {
  const series = [
    { date: '2024-01', etf: -5 },
    { date: '2024-02', etf: 0 },
    { date: '2024-03', etf: 5 },
  ]
  const result = mapSeriesToPolyline(series, 'etf', 100, 60)
  assert.equal(result, '0.00,60.00 50.00,30.00 100.00,0.00')
})

test('NaN/Infinity/-Infinity 视为缺失值并被过滤', () => {
  const series = [
    { date: '2024-01', etf: 1 },
    { date: '2024-02', etf: Number.NaN },
    { date: '2024-03', etf: Number.POSITIVE_INFINITY },
    { date: '2024-04', etf: Number.NEGATIVE_INFINITY },
    { date: '2024-05', etf: 2 },
  ]
  const result = mapSeriesToPolyline(series, 'etf', 100, 50)
  const points = result.split(' ')
  assert.equal(points.length, 2)
  assert.ok(!result.includes('NaN'))
  assert.ok(!result.includes('Infinity'))
})

test('未提供 width/height 时使用默认值 520x150', () => {
  const series = [
    { date: '2024-01', etf: 1 },
    { date: '2024-02', etf: 2 },
  ]
  const result = mapSeriesToPolyline(series, 'etf')
  assert.equal(result, '0.00,150.00 520.00,0.00')
})

test('部分缺失时 x 位置仍基于原始 index（不被压缩）', () => {
  const series = [
    { date: '2024-01', etf: 1 },
    { date: '2024-02' }, // 缺失
    { date: '2024-03', etf: 2 },
    { date: '2024-04', etf: 3 },
  ]
  // xStep = 90 / 3 = 30; 缺失的 index=1 不应让后续点向左挪
  const result = mapSeriesToPolyline(series, 'etf', 90, 50)
  const points = result.split(' ')
  assert.equal(points.length, 3)
  assert.ok(points[0].startsWith('0.00,'))
  assert.ok(points[1].startsWith('60.00,'))
  assert.ok(points[2].startsWith('90.00,'))
})

test('值为 0 时仍作为有效点（不被 falsy 过滤）', () => {
  const series = [
    { date: '2024-01', etf: 0 },
    { date: '2024-02', etf: 0 },
    { date: '2024-03', etf: 0 },
  ]
  const result = mapSeriesToPolyline(series, 'etf', 100, 50)
  // 三个点都应保留；span fallback 到 1 后 y 全部稳定
  assert.equal(result.split(' ').length, 3)
  assert.ok(!result.includes('NaN'))
})

test('字符串数值不会被当作有效点（Number.isFinite 严格）', () => {
  const series = [
    { date: '2024-01', etf: '1' },
    { date: '2024-02', etf: '2' },
  ]
  assert.equal(mapSeriesToPolyline(series, 'etf'), '')
})

test('错误的 key 返回空字符串而不抛出', () => {
  const series = [
    { date: '2024-01', etf: 1 },
    { date: '2024-02', etf: 2 },
  ]
  assert.equal(mapSeriesToPolyline(series, 'price'), '')
})

test('数组中含 null/undefined 元素时不抛出，且只产出有效点', () => {
  const series = [null, undefined, { date: '2024-01', etf: 1 }, { date: '2024-02', etf: 2 }]
  const result = mapSeriesToPolyline(series, 'etf', 100, 50)
  // 只有两个对象含有 etf；其它两个被过滤
  assert.equal(result.split(' ').length, 2)
  assert.ok(!result.includes('NaN'))
})
