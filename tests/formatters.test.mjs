import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatPercent,
  formatSignedPercent,
} from '../src/analysis/formatters.js'

test('formatPercent/formatSignedPercent: null (JSON NaN/Infinity 反序列化哨兵) 必须回退到 暂无 而非 0.00%', () => {
  // JSON.stringify 把 NaN/Infinity 序列化为 null。任何被 JSON 持久化或在 agent prompt 间往返的
  // percent 字段（折溢价/当日涨跌/跟踪差/换手率…）反序列化后会从 NaN/Infinity 变成 null。
  // 当前共享 formatPercent/formatSignedPercent 仅用 Number.isFinite(Number(value)) 守卫，
  // 而 Number(null)=0 是有限的，导致 null 被渲染成 "0.00%"（与 平盘日 / 贴近净值 同形），
  // 误读为合法 0% 而非"缺失"。memoFormatter 在内部包了一层 formatSignedPercentMetric 自救，
  // 但 App.jsx / DecisionDeck.jsx / signal.js 等共享调用点直接用 formatPercent/formatSignedPercent，
  // 没有这层保护。共享层必须把 null 与 undefined/NaN 一视同仁回退到 暂无，避免缺失语义在
  // JSON 反序列化后悄无声息丢失。
  assert.equal(formatPercent(null), '暂无', 'formatPercent(null) 必须回退到 暂无 而非 0.00%')
  assert.equal(formatSignedPercent(null), '暂无', 'formatSignedPercent(null) 必须回退到 暂无 而非 0.00%')

  // JSON 反序列化前提：NaN 与 Infinity 都会被 JSON.stringify 转成 null。
  const roundTripped = JSON.parse(JSON.stringify({
    premium: Number.NaN,
    dailyChange: Number.POSITIVE_INFINITY,
    trackingError: Number.NEGATIVE_INFINITY,
  }))
  assert.equal(roundTripped.premium, null, 'JSON.stringify 把 NaN 转成 null（前提）')
  assert.equal(roundTripped.dailyChange, null, 'JSON.stringify 把 +Infinity 转成 null（前提）')
  assert.equal(roundTripped.trackingError, null, 'JSON.stringify 把 -Infinity 转成 null（前提）')
  assert.equal(formatPercent(roundTripped.premium), '暂无', 'JSON 反序列化路径下 formatPercent 必须回退到 暂无')
  assert.equal(formatSignedPercent(roundTripped.dailyChange), '暂无', 'JSON 反序列化路径下 formatSignedPercent 必须回退到 暂无')
  assert.equal(formatPercent(roundTripped.trackingError), '暂无', '负无穷反序列化路径同样必须回退')

  // 回归守卫：合法 0 与 0.5 仍按现有契约渲染，不被 null 守卫误伤。
  assert.equal(formatPercent(0), '0.00%', 'formatPercent(0) 仍渲染为 0.00%（合法 0 不被误判为缺失）')
  assert.equal(formatPercent(0.5), '50.00%', 'formatPercent(0.5) 仍按 *100 渲染')
  assert.equal(formatSignedPercent(0.012), '+1.20%', 'formatSignedPercent 正值仍带 + 号')
  assert.equal(formatSignedPercent(-0.025), '-2.50%', 'formatSignedPercent 负值保留原生 - 号')
})

test('formatPercent/formatSignedPercent: 字符串数值不得伪装成合法 percent（numeric-only 契约）', () => {
  // 6d1be20 把守卫从 Number.isFinite(Number(value)) 收紧到 Number.isFinite(value)，副作用是
  // 把"看起来像数字的字符串"（"0.5" / "0" / "" / "-0.025"）从合法 percent 输入里挤出去：
  // JSON 字符串字段、URL 查询参数、表单回填、agent prompt 间往返再 parse 失败的退化路径里，
  // stringy percent 不再被 silent coerce 成 "50.00%" / "0.00%" 这种与 平盘日 / 贴近净值 同形
  // 的伪有效值。memoFormatter 内部走自己的 isFinite 守卫，但 App.jsx / DecisionDeck.jsx /
  // signal.js / 各 *Panels.jsx 都直接消费共享 formatter——契约必须显式 numeric-only，否则
  // 上游一处 schema 漂移就会把缺失语义伪装成合法 0%。本测试守住收紧后的边界：若未来有人
  // 为了"兼容性"在共享层重新加回 Number(value) 包裹，会立刻 RED。
  assert.equal(formatPercent('0.5'), '暂无', '字符串 "0.5" 不得被 coerce 成 50.00%')
  assert.equal(formatPercent('0'), '暂无', '字符串 "0" 不得被 coerce 成 0.00%（与 numeric 0 同形最危险）')
  assert.equal(formatPercent(''), '暂无', '空字符串 Number("")=0，必须显式拒绝以防伪装成 0.00%')
  assert.equal(formatSignedPercent('0.012'), '暂无', '字符串 "0.012" 不得被 coerce 成 +1.20%')
  assert.equal(formatSignedPercent('-0.025'), '暂无', '字符串 "-0.025" 不得被 coerce 成 -2.50%')

  // 回归守卫：numeric 0 与 numeric signed 仍按既有契约渲染，不被 numeric-only 收紧误伤。
  assert.equal(formatPercent(0), '0.00%', 'numeric 0 仍渲染为 0.00%（合法 0 不被误判为缺失）')
  assert.equal(formatSignedPercent(0), '0.00%', 'numeric 0 在 signed 路径下不带 + 号（既有契约：仅正值附 +）')
  assert.equal(formatSignedPercent(0.012), '+1.20%', 'numeric 正值仍带 + 号')
  assert.equal(formatSignedPercent(-0.025), '-2.50%', 'numeric 负值保留原生 - 号且不出现 +-')
})

test('formatPercent/formatSignedPercent: 非数字非字符串（boolean/array/object）必须回退到 暂无', () => {
  // PR #27 把守卫收紧到 Number.isFinite(value) 后，stringy percent 已被显式拒绝；本测试
  // 把 numeric-only 契约的另一侧——非 number 非 string 的"垃圾输入"——一并钉死。
  // 这些类型来自上游 schema 漂移、agent prompt 误装配、远端 JSON 字段缺失被默认值兜底
  // 等路径：Number(true)=1、Number([])=0、Number([0])=0 都是有限数字，若未来有人在共享层
  // 重新引入 Number(value) 包裹，会让 boolean true 渲染成 "100.00%"、空数组渲染成 "0.00%"
  // (与平盘日同形)、单元素数组 [0.5] 渲染成 "50.00%"——把"完全错误的类型"伪装成合法
  // percent。Number.isFinite(value) 不做隐式转换，对非 number 一律返回 false，本测试守住
  // 这条边界：若守卫被弱化，立刻 RED。
  assert.equal(formatPercent(true), '暂无', 'boolean true 不得被 coerce 成 100.00%')
  assert.equal(formatPercent(false), '暂无', 'boolean false 不得被 coerce 成 0.00%（与 numeric 0 同形最危险）')
  assert.equal(formatPercent([]), '暂无', '空数组 Number([])=0，必须显式拒绝以防伪装成 0.00%')
  assert.equal(formatPercent([0]), '暂无', '单元素数组 Number([0])=0，同样必须拒绝')
  assert.equal(formatPercent({}), '暂无', '普通对象 Number({})=NaN 已天然落到 暂无，本断言钉死该契约')
  assert.equal(formatSignedPercent(true), '暂无', 'signed 路径同样拒绝 boolean true')
  assert.equal(formatSignedPercent(false), '暂无', 'signed 路径同样拒绝 boolean false')
  assert.equal(formatSignedPercent([]), '暂无', 'signed 路径同样拒绝空数组')
  assert.equal(formatSignedPercent([0]), '暂无', 'signed 路径同样拒绝单元素数组')
  assert.equal(formatSignedPercent({}), '暂无', 'signed 路径同样拒绝普通对象')

  // 回归守卫：合法 numeric 仍按既有契约渲染，不被非 number 拒绝逻辑误伤。
  assert.equal(formatPercent(0), '0.00%', 'numeric 0 仍渲染为 0.00%')
  assert.equal(formatPercent(0.5), '50.00%', 'numeric 0.5 仍按 *100 渲染')
  assert.equal(formatSignedPercent(0.012), '+1.20%', 'numeric 正值仍带 + 号')
  assert.equal(formatSignedPercent(-0.025), '-2.50%', 'numeric 负值保留原生 - 号')
})
