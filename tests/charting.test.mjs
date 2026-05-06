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
