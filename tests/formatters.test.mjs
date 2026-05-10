import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatPercent,
  formatSignedPercent,
  formatNumber,
  formatCnyAmount,
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

test('formatPercent/formatSignedPercent: BigInt 与 boxed Number/Date/valueOf 包装类型必须回退到 暂无（numeric-primitive-only 契约）', () => {
  // PR #27 钉死 stringy、PR #28 钉死 boolean/array/object，最后留下的"会被 Number(value) 静默
  // 接受、却不是 number 原始值"的一类输入仍未被显式锁住：BigInt（Number(1n)=1）、boxed Number
  // 包装（Number(new Number(0.5))=0.5）、Date（Number(new Date(0))=0、Number(new Date(50))=50）、
  // 以及自定义 valueOf 对象（Number({valueOf:()=>0.5})=0.5）。这些类型最容易从远端 JSON 转换层、
  // 金融 API（用 BigInt 表大额数量）、legacy 代码 new Number(...) 测试夹具、Date/percent 字段
  // 串位等路径漂移进 percent 入口。Number(value) 旧守卫下，1n 会渲染成 "100.00%"、boxed Number(0.5)
  // 会渲染成 "50.00%"、Date(0) 与 valueOf-0 会渲染成 "0.00%"——把"非 number 原始值"伪装成合法
  // percent。Number.isFinite(value) 不做隐式拆箱/转换，对 BigInt/包装对象/Date/valueOf-obj 一律
  // 返回 false。本测试守住共享 percent 契约的"numeric primitive only"边界：若未来有人为兼容
  // BigInt 或 boxed Number 在共享层加回 Number(value) 包裹，立刻 RED。
  assert.equal(formatPercent(0n), '暂无', 'BigInt 0n 不得被 coerce 成 0.00%（Number(0n)=0 旧守卫会漏过）')
  assert.equal(formatPercent(1n), '暂无', 'BigInt 1n 不得被 coerce 成 100.00%（Number(1n)=1 旧守卫会漏过）')
  assert.equal(formatPercent(-1n), '暂无', 'BigInt -1n 不得被 coerce 成 -100.00%')
  assert.equal(formatPercent(new Number(0.5)), '暂无', 'boxed Number(0.5) 不得被拆箱成 50.00%')
  assert.equal(formatPercent(new Number(0)), '暂无', 'boxed Number(0) 不得被拆箱成 0.00%（与 numeric 0 同形最危险）')
  assert.equal(formatPercent(new Date(0)), '暂无', 'Date(0) 不得被 valueOf 转成 0.00%（Number(date) 走 timestamp 路径）')
  assert.equal(formatPercent({ valueOf: () => 0.5 }), '暂无', '自定义 valueOf 对象不得被拆箱成 50.00%')
  assert.equal(formatPercent({ valueOf: () => 0 }), '暂无', '自定义 valueOf 返回 0 不得被拆箱成 0.00%')
  assert.equal(formatSignedPercent(1n), '暂无', 'signed 路径同样拒绝 BigInt 1n')
  assert.equal(formatSignedPercent(-1n), '暂无', 'signed 路径同样拒绝 BigInt -1n')
  assert.equal(formatSignedPercent(new Number(0.012)), '暂无', 'signed 路径同样拒绝 boxed Number(0.012)')
  assert.equal(formatSignedPercent(new Date(0)), '暂无', 'signed 路径同样拒绝 Date(0)')
  assert.equal(formatSignedPercent({ valueOf: () => 0.012 }), '暂无', 'signed 路径同样拒绝自定义 valueOf 对象')

  // 回归守卫：合法 number 原始值仍按既有契约渲染，不被 numeric-primitive-only 拒绝逻辑误伤。
  assert.equal(formatPercent(0), '0.00%', 'numeric 0 仍渲染为 0.00%')
  assert.equal(formatPercent(0.5), '50.00%', 'numeric 0.5 仍按 *100 渲染')
  assert.equal(formatSignedPercent(0.012), '+1.20%', 'numeric 正值仍带 + 号')
  assert.equal(formatSignedPercent(-0.025), '-2.50%', 'numeric 负值保留原生 - 号')
})

test('formatNumber: 非 number 原始值（null/numeric string/boolean/array/boxed Number/Date/valueOf/BigInt）必须回退到 暂无（numeric-primitive-only 契约）', () => {
  // PR #26-#29 已经把共享 percent 入口 formatPercent/formatSignedPercent 收紧到
  // numeric-primitive-only 契约：null/numeric string/boolean/array/boxed Number/Date/valueOf
  // 一律回退到 暂无。formatNumber 是同一组共享 formatter 里的"display number"入口，被
  // App.jsx（基金规模 / 份额）/ StrategyPanels.jsx（盈亏比）/ MarketPanels.jsx（驱动价格）
  // 等多处直接消费，当前却仍用 Number.isFinite(Number(value)) 旧守卫——Number(null)=0、
  // Number('1234.5')=1234.5、Number(true)=1、Number([1234])=1234、Number(new Number(0))=0、
  // Number(new Date(0))=0、Number({valueOf:()=>0})=0 都是有限数字，会让"非 number 原始值"
  // 静默渲染成 "0.00" / "1,234.50" / "1.00" 这种合法 display number，把上游 schema 漂移、
  // JSON 反序列化哨兵、prompt 误装配伪装成合法零或合法值。Number.isFinite(value) 不做
  // 隐式拆箱/转换，对 BigInt/包装对象/Date/valueOf-obj/numeric string/boolean/array 一律
  // 返回 false——必须把 formatNumber 与 percent 对齐到同一条 numeric-primitive-only 边界，
  // 这样共享 formatter 才能在缺失语义上保持一致。

  // null/undefined：JSON.stringify NaN/Infinity 反序列化哨兵，未初始化字段。
  assert.equal(formatNumber(null), '暂无', 'null 不得被 coerce 成 0.00（与 numeric 0 同形最危险）')
  assert.equal(formatNumber(undefined), '暂无', 'undefined 仍回退到 暂无（既有契约）')

  // numeric string：URL 查询参数/表单回填/JSON 字符串字段/agent prompt 往返再 parse 失败。
  assert.equal(formatNumber('0'), '暂无', '字符串 "0" 不得被 coerce 成 0.00')
  assert.equal(formatNumber('1234.5'), '暂无', '字符串 "1234.5" 不得被 coerce 成 1,234.50')
  assert.equal(formatNumber(''), '暂无', '空字符串 Number("")=0，必须显式拒绝以防伪装成 0.00')

  // boolean：上游 schema 漂移把开关字段串到数值字段。
  assert.equal(formatNumber(true), '暂无', 'boolean true 不得被 coerce 成 1.00')
  assert.equal(formatNumber(false), '暂无', 'boolean false 不得被 coerce 成 0.00')

  // array：prompt 误装配 / 远端 JSON 默认值兜底成数组。
  assert.equal(formatNumber([]), '暂无', '空数组 Number([])=0，必须显式拒绝以防伪装成 0.00')
  assert.equal(formatNumber([0]), '暂无', '单元素数组 Number([0])=0，同样必须拒绝')
  assert.equal(formatNumber([1234]), '暂无', '单元素数组 Number([1234])=1234，同样必须拒绝以防伪装成 1,234.00')

  // 普通对象：Number({})=NaN 已天然落到 暂无，本断言钉死该契约。
  assert.equal(formatNumber({}), '暂无', '普通对象天然 NaN，钉死回退契约')

  // boxed Number：legacy fixture / new Number(...)。
  assert.equal(formatNumber(new Number(0)), '暂无', 'boxed Number(0) 不得被拆箱成 0.00')
  assert.equal(formatNumber(new Number(1234.5)), '暂无', 'boxed Number(1234.5) 不得被拆箱成 1,234.50')

  // Date：字段串位（把日期串到数值字段），Number(date) 走 timestamp 路径。
  assert.equal(formatNumber(new Date(0)), '暂无', 'Date(0) 不得被 valueOf 转成 0.00')
  assert.equal(formatNumber(new Date(1234)), '暂无', 'Date(1234) 不得被 valueOf 转成 1,234.00')

  // 自定义 valueOf 对象：自定义 toJSON/valueOf 的 wrapper。
  assert.equal(formatNumber({ valueOf: () => 0 }), '暂无', 'valueOf-obj 返回 0 不得被拆箱成 0.00')
  assert.equal(formatNumber({ valueOf: () => 1234 }), '暂无', 'valueOf-obj 返回 1234 不得被拆箱成 1,234.00')

  // BigInt：金融 API 用 BigInt 表大额数量。Number.isFinite(1n)=false 天然守卫。
  assert.equal(formatNumber(0n), '暂无', 'BigInt 0n 不得被 coerce 成 0.00')
  assert.equal(formatNumber(1234n), '暂无', 'BigInt 1234n 不得被 coerce 成 1,234.00')

  // NaN/Infinity：未守卫的非有限 number。
  assert.equal(formatNumber(Number.NaN), '暂无', 'NaN 仍回退到 暂无')
  assert.equal(formatNumber(Number.POSITIVE_INFINITY), '暂无', '+Infinity 仍回退到 暂无')
  assert.equal(formatNumber(Number.NEGATIVE_INFINITY), '暂无', '-Infinity 仍回退到 暂无')

  // 回归守卫：合法 number 原始值仍按既有契约渲染，不被 numeric-primitive-only 拒绝逻辑误伤。
  assert.equal(formatNumber(0), '0.00', 'numeric 0 仍渲染为 0.00（默认 2 位小数）')
  assert.equal(formatNumber(0, 0), '0', 'numeric 0 在 0 位小数下渲染为 "0"')
  assert.equal(formatNumber(1234.5678, 2), '1,234.57', 'numeric 仍按 zh-CN locale 加千分位')
  assert.equal(formatNumber(1234.5678, 0), '1,235', 'numeric 0 位小数仍走 toLocaleString 取整')
  assert.equal(formatNumber(-1234, 0), '-1,234', '负值仍保留 - 号')

  // formatCnyAmount 仍正确委托 formatNumber 处理 numeric 输入，不被本次收紧拖累。
  assert.equal(formatCnyAmount(150000000), '1.50亿', 'formatCnyAmount 仍按亿/万分级渲染合法 numeric')
  assert.equal(formatCnyAmount(15000), '1.50万', 'formatCnyAmount 仍按万分级渲染合法 numeric')
  assert.equal(formatCnyAmount(1234), '1,234', 'formatCnyAmount 仍把 < 万 的 numeric 走 0 位小数')
  assert.equal(formatCnyAmount(null), '暂无', 'formatCnyAmount 既有 numeric-primitive-only 守卫保留')
})
