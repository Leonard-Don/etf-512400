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
