import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareHoldingsNumeric } from '../src/components/holdingsTableSort.js'

test('compareHoldingsNumeric: 有限 number 原始值正常按数值排序，0 仍是合法 number（asc/desc）', () => {
  // 升序（factor=1）：小→大
  assert.ok(compareHoldingsNumeric(1, 2, 1) < 0, '1 < 2 升序')
  assert.ok(compareHoldingsNumeric(2, 1, 1) > 0, '2 > 1 升序')
  assert.equal(compareHoldingsNumeric(3, 3, 1), 0, '相等返回 0')

  // 降序（factor=-1）：大→小
  assert.ok(compareHoldingsNumeric(2, 1, -1) < 0, '2 排在 1 前（降序）')
  assert.ok(compareHoldingsNumeric(1, 2, -1) > 0, '1 排在 2 后（降序）')

  // 0 仍是合法 number，不被当成缺失
  assert.ok(compareHoldingsNumeric(-1, 0, 1) < 0, '-1 < 0 升序')
  assert.ok(compareHoldingsNumeric(0, 1, 1) < 0, '0 < 1 升序，合法 0 不被误判')
  assert.ok(compareHoldingsNumeric(0, -1, -1) < 0, '0 在 -1 前（降序）')

  // 负数与小数也按数值比较
  assert.ok(compareHoldingsNumeric(-2, -1, 1) < 0, '-2 < -1 升序')
  assert.ok(compareHoldingsNumeric(0.5, 1.25, 1) < 0, '0.5 < 1.25 升序')
})

test('compareHoldingsNumeric: null/undefined/NaN 不被 coerce 成 0，必须排在合法 number 之后（asc & desc 一致）', () => {
  // 旧实现用 (av ?? 0) - (bv ?? 0)：null/undefined 被 coerce 成 0，与合法 0 同形——
  // 在权重表里会让"权重缺失"的持仓伪装成 0%、与合法 0% 持仓挤在一起，且方向翻转时
  // 缺失值会跑到列首；这破坏了 numeric-primitive-only 契约（formatPercent/formatNumber
  // 已在 PR #26-#30 把同一契约钉死在共享 formatter 上）。HoldingsTable 的排序入口必须
  // 与 formatter 入口对齐：只有 Number.isFinite(value) 的原始 number 参与数值比较，
  // 其余一律排在合法 number 之后，且 asc/desc 表现一致——把"缺失"在两个方向上都钉到列尾，
  // 而不是依赖方向因子翻转。

  // 升序：合法 number 在前，缺失在后（无论是 a 还是 b 缺失）
  assert.ok(compareHoldingsNumeric(1, null, 1) < 0, '1 排在 null 前（升序）')
  assert.ok(compareHoldingsNumeric(null, 1, 1) > 0, 'null 排在 1 后（升序）')
  assert.ok(compareHoldingsNumeric(0, null, 1) < 0, '合法 0 排在 null 前（不被误判为相等）')
  assert.ok(compareHoldingsNumeric(null, 0, 1) > 0, 'null 排在合法 0 后（不被误判为相等）')

  assert.ok(compareHoldingsNumeric(1, undefined, 1) < 0, '1 排在 undefined 前（升序）')
  assert.ok(compareHoldingsNumeric(undefined, 1, 1) > 0, 'undefined 排在 1 后（升序）')

  assert.ok(compareHoldingsNumeric(1, Number.NaN, 1) < 0, '1 排在 NaN 前（升序）')
  assert.ok(compareHoldingsNumeric(Number.NaN, 1, 1) > 0, 'NaN 排在 1 后（升序）')

  // 降序：方向翻转，但缺失仍在列尾——这是与"乘 factor"老实现的关键差异
  assert.ok(compareHoldingsNumeric(1, null, -1) < 0, '1 排在 null 前（降序，缺失仍在列尾）')
  assert.ok(compareHoldingsNumeric(null, 1, -1) > 0, 'null 排在 1 后（降序，缺失仍在列尾）')
  assert.ok(compareHoldingsNumeric(0, null, -1) < 0, '合法 0 排在 null 前（降序，不被翻到列首）')
  assert.ok(compareHoldingsNumeric(null, 0, -1) > 0, 'null 排在合法 0 后（降序，不被翻到列首）')
  assert.ok(compareHoldingsNumeric(0, undefined, -1) < 0, '合法 0 排在 undefined 前（降序）')
  assert.ok(compareHoldingsNumeric(0, Number.NaN, -1) < 0, '合法 0 排在 NaN 前（降序）')

  // ±Infinity 也不参与（与共享 formatter 契约一致：Number.isFinite 拒绝 ±Infinity）
  assert.ok(compareHoldingsNumeric(1, Number.POSITIVE_INFINITY, 1) < 0, '+Infinity 排在合法 number 后（升序）')
  assert.ok(compareHoldingsNumeric(Number.POSITIVE_INFINITY, 1, 1) > 0, '+Infinity 排在合法 number 后（升序）')
  assert.ok(compareHoldingsNumeric(1, Number.NEGATIVE_INFINITY, -1) < 0, '-Infinity 排在合法 number 后（降序）')
})

test('compareHoldingsNumeric: 字符串/布尔/数组/对象/BigInt 不得 coerce 成数字，必须排在合法 number 之后', () => {
  // 旧实现的 (av ?? 0) - (bv ?? 0) 走 - 运算符的隐式 ToNumber：
  //   '0.5' → 0.5、'0' → 0、'' → 0、true → 1、false → 0、[] → 0、[5] → 5。
  // 这让上游 schema 漂移、JSON 字符串字段、URL/表单回填、prompt 误装配等路径里的
  // stringy/bool/array 权重伪装成合法数字参与排序，与合法持仓混排——同形最危险的是
  // false / '' / '0' / [] 全被当成 0，与合法 0% 持仓挤在一起。numeric-primitive-only
  // 契约（与 formatPercent/formatNumber 对齐）要求这些类型显式落到列尾。

  // string 不参与
  assert.ok(compareHoldingsNumeric(1, '0.5', 1) < 0, '字符串 "0.5" 排在合法 1 后（升序）')
  assert.ok(compareHoldingsNumeric('0.5', 1, 1) > 0, '字符串 "0.5" 排在合法 1 后（升序）')
  assert.ok(compareHoldingsNumeric(0, '0', 1) < 0, '合法 0 排在字符串 "0" 前（不被误判为相等）')
  assert.ok(compareHoldingsNumeric(0, '', 1) < 0, '合法 0 排在空字符串前（不被 Number("")=0 伪装）')
  assert.ok(compareHoldingsNumeric(0, '0', -1) < 0, '降序方向缺失仍在列尾')

  // boolean 不参与
  assert.ok(compareHoldingsNumeric(0, true, 1) < 0, '合法 0 排在 true 前（不被 Number(true)=1 伪装）')
  assert.ok(compareHoldingsNumeric(0, false, 1) < 0, '合法 0 排在 false 前（不被 Number(false)=0 伪装为相等）')
  assert.ok(compareHoldingsNumeric(true, 0, 1) > 0, 'true 排在合法 0 后（升序）')
  assert.ok(compareHoldingsNumeric(0, false, -1) < 0, '合法 0 排在 false 前（降序方向缺失仍在列尾）')

  // array 不参与（[] → 0、[5] → 5 旧实现下会伪装成数字）
  assert.ok(compareHoldingsNumeric(0, [], 1) < 0, '合法 0 排在空数组前（不被 Number([])=0 伪装）')
  assert.ok(compareHoldingsNumeric(0, [5], 1) < 0, '合法 0 排在 [5] 前（不被 Number([5])=5 伪装）')
  assert.ok(compareHoldingsNumeric([5], 0, 1) > 0, '[5] 排在合法 0 后（升序）')

  // 普通对象（Number({})=NaN，旧实现下产生 NaN 比较——sort 行为不可预测）
  assert.ok(compareHoldingsNumeric(0, {}, 1) < 0, '合法 0 排在普通对象前')
  assert.ok(compareHoldingsNumeric({}, 0, 1) > 0, '普通对象排在合法 0 后')

  // BigInt（Number.isFinite(1n)=false 天然守卫；旧实现下 BigInt - number 抛 TypeError，
  // 这里钉死成"排在合法 number 之后"而不是异常）
  assert.ok(compareHoldingsNumeric(0, 1n, 1) < 0, '合法 0 排在 BigInt 后')
  assert.ok(compareHoldingsNumeric(1n, 0, 1) > 0, 'BigInt 排在合法 0 后')

  // boxed Number / Date / valueOf 包装类型不参与（与 PR #29 numeric-primitive-only 边界一致）
  assert.ok(compareHoldingsNumeric(0, new Number(1), 1) < 0, '合法 0 排在 boxed Number(1) 前')
  assert.ok(compareHoldingsNumeric(0, new Date(1000), 1) < 0, '合法 0 排在 Date 前')
  assert.ok(compareHoldingsNumeric(0, { valueOf: () => 5 }, 1) < 0, '合法 0 排在 valueOf-obj 前')
})

test('compareHoldingsNumeric: 两侧都缺失时返回 0（asc/desc 都给 stable fallback）', () => {
  // 当 a 与 b 都不是合法 number 原始值时，比较函数返回 0，让 Array.prototype.sort
  // 保持原顺序（V8 等主流引擎的 TimSort 是稳定排序）——这意味着两条权重缺失的持仓
  // 在升序/降序表里都按原始数据顺序展示，而不是被任意打乱。
  assert.equal(compareHoldingsNumeric(null, null, 1), 0)
  assert.equal(compareHoldingsNumeric(null, undefined, 1), 0)
  assert.equal(compareHoldingsNumeric(undefined, Number.NaN, 1), 0)
  assert.equal(compareHoldingsNumeric(Number.NaN, 'foo', 1), 0)
  assert.equal(compareHoldingsNumeric('foo', true, 1), 0)
  assert.equal(compareHoldingsNumeric(true, false, 1), 0, 'true 与 false 旧实现 (1-0)=1，新契约下都不参与，返回 0')
  assert.equal(compareHoldingsNumeric([], [5], 1), 0)
  assert.equal(compareHoldingsNumeric(1n, 2n, 1), 0)

  // 降序方向同样返回 0
  assert.equal(compareHoldingsNumeric(null, undefined, -1), 0)
  assert.equal(compareHoldingsNumeric(true, false, -1), 0)
})

test('compareHoldingsNumeric: 端到端 sort 验证——混合合法/缺失值在 asc/desc 都把缺失稳定钉到列尾', () => {
  // 模拟 HoldingsTable 实际调用：一组权重含合法 number、null（JSON NaN/Infinity 哨兵）、
  // NaN（直接非有限）、字符串（schema 漂移）、boolean（开关字段串位）。验证两个方向都把
  // 合法值正确排序、缺失值钉到列尾、并保持缺失值之间的稳定原始顺序。
  const items = [
    { code: 'A', weight: 5 },
    { code: 'B', weight: null },
    { code: 'C', weight: 3 },
    { code: 'D', weight: 'invalid' },
    { code: 'E', weight: 1 },
    { code: 'F', weight: Number.NaN },
    { code: 'G', weight: false },
  ]

  const asc = [...items].sort((a, b) => compareHoldingsNumeric(a.weight, b.weight, 1))
  // 合法 number 升序：1(E), 3(C), 5(A)；其后是缺失，按原始数组顺序：B, D, F, G
  assert.deepEqual(
    asc.map((it) => it.code),
    ['E', 'C', 'A', 'B', 'D', 'F', 'G'],
    '升序：合法 number 1→3→5 在前，缺失按原始顺序稳定钉到列尾',
  )

  const desc = [...items].sort((a, b) => compareHoldingsNumeric(a.weight, b.weight, -1))
  // 合法 number 降序：5(A), 3(C), 1(E)；其后是缺失，按原始数组顺序：B, D, F, G
  // 这是与"乘 factor"老实现的关键差异：方向翻转时缺失仍在列尾，不会跑到列首。
  assert.deepEqual(
    desc.map((it) => it.code),
    ['A', 'C', 'E', 'B', 'D', 'F', 'G'],
    '降序：合法 number 5→3→1 在前，缺失按原始顺序稳定钉到列尾（不随 factor 翻到列首）',
  )
})
