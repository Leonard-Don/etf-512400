import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculatePremium,
  calculateDailyChange,
} from '../src/analysis/fundamentals.js'

test('calculatePremium/calculateDailyChange: 非有限/缺失 price 必须回退到 0 而非把 null 隐式 coerce 成 -1', () => {
  // App.jsx 顶部 const activePrice = activeQuote.price ?? etfProfile.price，两层兜底之后
  // 在彻底降级路径里仍可能为 null/undefined（实时源全失败 + snapshot 缺字段）。
  // calculatePremium / calculateDailyChange 当前只用 if (!nav) / if (!previousClose) 守卫，
  // 对 price 一侧完全不检查——null/undefined 会被算术运算静默 coerce：
  //   * Number(null) = 0  → null / 1.5 - 1 = -1（伪 -100% 折价）
  //   * Number(undefined) = NaN → NaN/1.5 - 1 = NaN
  //   * Number.isFinite 假；但 -1 是合法有限数字，会直通到下游
  // -1 经 signal.js 第 43 行 clamp(VALUATION_BASE - premium * VALUATION_SLOPE, 0, 100)
  // 算出 clamp(58 + 1800, 0, 100) = 100 满分估值，把"价格缺失"伪装成"极度低估"，
  // 又因 -1 < VETO.premium=0.008，不触发禁止追高，估值评分被极度抬高、reasons 渲染
  // "折溢价：-100.00%"——把缺失语义伪装成极端折价。守卫必须显式拒绝非有限 price。
  assert.equal(calculatePremium(null, 1.5), 0, 'null price 必须回退到 0 而非 -1（null/1.5-1 的隐式 coerce）')
  assert.equal(calculatePremium(undefined, 1.5), 0, 'undefined price 必须回退到 0 而非 NaN')
  assert.equal(calculatePremium(Number.NaN, 1.5), 0, 'NaN price 必须回退到 0')
  assert.equal(calculatePremium(Number.POSITIVE_INFINITY, 1.5), 0, '+Infinity price 必须回退到 0')
  assert.equal(calculatePremium(Number.NEGATIVE_INFINITY, 1.5), 0, '-Infinity price 必须回退到 0')

  assert.equal(calculateDailyChange(null, 2.119), 0, 'null price 必须回退到 0 而非 -1（伪 -100% 跌幅）')
  assert.equal(calculateDailyChange(undefined, 2.119), 0, 'undefined price 必须回退到 0 而非 NaN')
  assert.equal(calculateDailyChange(Number.NaN, 2.119), 0, 'NaN price 必须回退到 0')
  assert.equal(calculateDailyChange(Number.POSITIVE_INFINITY, 2.119), 0, '+Infinity price 必须回退到 0')

  // 非有限 nav/previousClose 也必须回退；既有 if (!nav) 对 0/null/undefined/NaN 守住，
  // 但 Infinity 是 truthy，会让 price/Infinity = 0，返回 -1 伪 -100%。
  assert.equal(calculatePremium(2.2, Number.POSITIVE_INFINITY), 0, '+Infinity nav 不得被 price/Infinity=0 算成 -1')
  assert.equal(calculateDailyChange(2.2, Number.POSITIVE_INFINITY), 0, '+Infinity previousClose 同样必须回退到 0')

  // 回归守卫：合法有限输入仍按既有契约渲染，不被新守卫误伤。
  // 浮点结果用 toFixed 锚定（避免不同 ICU/V8 版本上小数尾位漂移），同时确保是合法非零数值。
  assert.equal((calculatePremium(2.2, 2.0)).toFixed(4), '0.1000', '合法输入仍正确计算溢价（2.2/2.0-1=0.10）')
  assert.equal((calculateDailyChange(2.195, 2.119)).toFixed(4), '0.0359', '合法输入仍正确计算当日涨跌（2.195/2.119-1≈3.59%）')

  // 既有零分母契约保留：nav/previousClose = 0/null/undefined/NaN 仍回退到 0。
  assert.equal(calculatePremium(2.2, 0), 0, 'nav=0 既有契约保留')
  assert.equal(calculatePremium(2.2, null), 0, 'nav=null 既有契约保留')
  assert.equal(calculatePremium(2.2, Number.NaN), 0, 'nav=NaN 既有契约保留')
  assert.equal(calculateDailyChange(2.2, 0), 0, 'previousClose=0 既有契约保留')
  assert.equal(calculateDailyChange(2.2, null), 0, 'previousClose=null 既有契约保留')
})
