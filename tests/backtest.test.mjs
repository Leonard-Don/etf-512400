import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBacktestStrategies } from '../src/analysis/backtest.js'

const baseFactorBaskets = [
  { trend: 65, risk: 50, weight: 30 },
  { trend: 60, risk: 55, weight: 30 },
  { trend: 55, risk: 60, weight: 20 },
  { trend: 50, risk: 50, weight: 20 },
]

function flatKlines(days, price = 100) {
  const out = []
  const start = new Date('2024-01-01')
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    out.push({ date: date.toISOString().slice(0, 10), close: price })
  }
  return out
}

function risingKlines(days, dailyGrowth = 0.001) {
  const out = []
  const start = new Date('2024-01-01')
  let close = 100
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    out.push({ date: date.toISOString().slice(0, 10), close })
    close *= 1 + dailyGrowth
  }
  return out
}

const approx = (actual, expected, tol) => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `期望 ${expected} ± ${tol}，实际 ${actual}`,
  )
}

test('样本不足 → currentAction = "样本不足"', () => {
  const klines = flatKlines(15)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  results.forEach((strategy) => {
    assert.equal(strategy.currentAction, '样本不足', `${strategy.name} 应该样本不足`)
    assert.equal(strategy.sampleSize, 15)
  })
})

test('买入持有 在平盘行情下 annualReturn ≈ 0、maxDrawdown = 0', () => {
  const klines = flatKlines(120)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const buyHold = results.find((s) => s.id === 'buyHold')
  assert.ok(buyHold)
  approx(buyHold.annualReturn, 0, 1e-9)
  approx(buyHold.maxDrawdown, 0, 1e-9)
  approx(buyHold.exposure, 1, 1e-9)
})

test('买入持有 在单调上涨行情下 annualReturn 与几何复利一致', () => {
  // 250 个交易日、每日 +0.1% → 总收益 (1.001)^249 - 1，年化 (1+总)^(252/249) - 1
  const days = 250
  const dailyGrowth = 0.001
  const klines = risingKlines(days, dailyGrowth)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const buyHold = results.find((s) => s.id === 'buyHold')

  const expectedTotal = (1 + dailyGrowth) ** (days - 1) - 1
  const expectedAnnual = (1 + expectedTotal) ** (252 / (days - 1)) - 1

  approx(buyHold.totalReturn, expectedTotal, 1e-9)
  approx(buyHold.annualReturn, expectedAnnual, 1e-9)
  approx(buyHold.maxDrawdown, 0, 1e-9)
})

test('回撤策略在持续上涨时几乎不出手 → exposure 较低', () => {
  const klines = risingKlines(250, 0.001)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const pullback = results.find((s) => s.id === 'pullback')
  // 没有 5%+ 回撤，exposure 期望接近 0
  assert.ok(pullback.exposure < 0.2, `期望低暴露，实际 ${pullback.exposure}`)
})

test('benchmarkAnnualReturn 等于 buyHold annualReturn', () => {
  const klines = risingKlines(250, 0.0008)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const buyHold = results.find((s) => s.id === 'buyHold')
  results.forEach((strategy) => {
    approx(strategy.benchmarkAnnualReturn, buyHold.annualReturn, 1e-9)
  })
})

test('所有策略输出 sampleSize 与输入一致', () => {
  const klines = risingKlines(120, 0.0005)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  results.forEach((strategy) => {
    assert.equal(strategy.sampleSize, 120)
  })
})

function pullbackKlines(prefixDays, prefixPrice, finalPrice) {
  const out = []
  const start = new Date('2024-01-01')
  for (let i = 0; i < prefixDays; i += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    out.push({ date: date.toISOString().slice(0, 10), close: prefixPrice })
  }
  const finalDate = new Date(start)
  finalDate.setDate(start.getDate() + prefixDays)
  out.push({ date: finalDate.toISOString().slice(0, 10), close: finalPrice })
  return out
}

function recoveryKlines() {
  // 60 天 100 → 5 天 80 → 1 天反弹 105，制造 close > ma60 但 ma20 < ma60 的中间态
  const out = []
  const start = new Date('2024-01-01')
  let day = 0
  for (let i = 0; i < 60; i += 1, day += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + day)
    out.push({ date: date.toISOString().slice(0, 10), close: 100 })
  }
  for (let i = 0; i < 5; i += 1, day += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + day)
    out.push({ date: date.toISOString().slice(0, 10), close: 80 })
  }
  const finalDate = new Date(start)
  finalDate.setDate(start.getDate() + day)
  out.push({ date: finalDate.toISOString().slice(0, 10), close: 105 })
  return out
}

const strongFactorBaskets = [
  { trend: 80, risk: 50, weight: 30 },
  { trend: 80, risk: 55, weight: 30 },
  { trend: 80, risk: 60, weight: 20 },
  { trend: 80, risk: 50, weight: 20 },
]

test('cleanKlines 过滤 NaN/Infinity close，sampleSize 反映清洗后数量', () => {
  const klines = flatKlines(50)
  klines[5].close = NaN
  klines[10].close = Infinity
  klines[15].close = -Infinity
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  results.forEach((strategy) => {
    assert.equal(strategy.sampleSize, 47, `${strategy.name} sampleSize 应该是 47 (50 - 3)`)
  })
})

test('cleanKlines 排序：倒序输入与升序输入产生一致结果', () => {
  const sorted = risingKlines(120, 0.001)
  const reversed = [...sorted].reverse()
  const sortedRes = buildBacktestStrategies({ klines: sorted, factorBaskets: baseFactorBaskets })
  const reversedRes = buildBacktestStrategies({ klines: reversed, factorBaskets: baseFactorBaskets })
  sortedRes.forEach((strategy, i) => {
    approx(strategy.totalReturn, reversedRes[i].totalReturn, 1e-9)
    approx(strategy.benchmarkAnnualReturn, reversedRes[i].benchmarkAnnualReturn, 1e-9)
    approx(strategy.maxDrawdown, reversedRes[i].maxDrawdown, 1e-9)
  })
})

test('factor 策略：trendScore < 58 → 因子未共振', () => {
  const klines = risingKlines(250, 0.001)
  const lowTrendBaskets = [
    { trend: 50, risk: 50, weight: 30 },
    { trend: 45, risk: 55, weight: 30 },
    { trend: 40, risk: 60, weight: 20 },
    { trend: 30, risk: 50, weight: 20 },
  ]
  const results = buildBacktestStrategies({ klines, factorBaskets: lowTrendBaskets })
  const factor = results.find((s) => s.id === 'factor')
  assert.equal(factor.currentAction, '因子未共振')
  approx(factor.currentExposure, 0, 1e-9)
})

test('factor 策略：highRiskFactors > 2 即使强趋势也未共振', () => {
  const klines = risingKlines(250, 0.001)
  const highRiskBaskets = [
    { trend: 80, risk: 75, weight: 30 },
    { trend: 80, risk: 80, weight: 30 },
    { trend: 80, risk: 90, weight: 20 },
    { trend: 80, risk: 50, weight: 20 },
  ]
  const results = buildBacktestStrategies({ klines, factorBaskets: highRiskBaskets })
  const factor = results.find((s) => s.id === 'factor')
  assert.equal(factor.currentAction, '因子未共振')
  approx(factor.currentExposure, 0, 1e-9)
})

test('factor 策略：因子共振 + 持续上涨 → 因子加仓 (exposure ≈ 0.82)', () => {
  const klines = risingKlines(250, 0.001)
  const results = buildBacktestStrategies({ klines, factorBaskets: strongFactorBaskets })
  const factor = results.find((s) => s.id === 'factor')
  assert.equal(factor.currentAction, '因子加仓')
  approx(factor.currentExposure, 0.82, 1e-9)
})

test('factor 策略：因子共振 + close > ma60 但 ma20 < ma60 → 小仓跟踪 (0.45)', () => {
  const klines = recoveryKlines()
  const results = buildBacktestStrategies({ klines, factorBaskets: strongFactorBaskets })
  const factor = results.find((s) => s.id === 'factor')
  approx(factor.currentExposure, 0.45, 1e-9)
  assert.equal(factor.currentAction, '小仓跟踪')
})

test('factor 策略：因子共振但样本 < 60 → exposure = 0.4 → 小仓跟踪', () => {
  const klines = flatKlines(30)
  const results = buildBacktestStrategies({ klines, factorBaskets: strongFactorBaskets })
  const factor = results.find((s) => s.id === 'factor')
  approx(factor.currentExposure, 0.4, 1e-9)
  assert.equal(factor.currentAction, '小仓跟踪')
})

test('factor 策略：空 factorBaskets → 因子未共振', () => {
  const klines = risingKlines(120, 0.001)
  const results = buildBacktestStrategies({ klines, factorBaskets: [] })
  const factor = results.find((s) => s.id === 'factor')
  assert.equal(factor.currentAction, '因子未共振')
  approx(factor.currentExposure, 0, 1e-9)
})

test('factor 策略：factorBaskets 全权重 0 → 因子未共振', () => {
  const klines = risingKlines(120, 0.001)
  const zeroWeightBaskets = [
    { trend: 90, risk: 50, weight: 0 },
    { trend: 90, risk: 50, weight: 0 },
  ]
  const results = buildBacktestStrategies({ klines, factorBaskets: zeroWeightBaskets })
  const factor = results.find((s) => s.id === 'factor')
  // totalWeight 兜底为 1，但 sum(trend*0) = 0，trendScore = 0 < 58
  assert.equal(factor.currentAction, '因子未共振')
})

test('factor 策略：factorBaskets 含 NaN trend → 因子未共振', () => {
  const klines = risingKlines(120, 0.001)
  const malformed = [
    { trend: NaN, risk: 50, weight: 30 },
    { trend: NaN, risk: 60, weight: 30 },
  ]
  const results = buildBacktestStrategies({ klines, factorBaskets: malformed })
  const factor = results.find((s) => s.id === 'factor')
  // NaN 比较恒为 false，factorGate 失败
  assert.equal(factor.currentAction, '因子未共振')
})

test('trend 策略：样本 ≥ 22 但 < 60 → exposure = 0.5 → 观察仓', () => {
  const klines = flatKlines(30)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const trend = results.find((s) => s.id === 'trend')
  approx(trend.currentExposure, 0.5, 1e-9)
  assert.equal(trend.currentAction, '观察仓')
})

test('trend 策略：close > ma60 但 ma20 < ma60 → exposure = 0.55 → 观察仓', () => {
  const klines = recoveryKlines()
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const trend = results.find((s) => s.id === 'trend')
  approx(trend.currentExposure, 0.55, 1e-9)
  assert.equal(trend.currentAction, '观察仓')
})

test('pullback 策略：drawdown ≈ -5% → exposure = 0.33 → 第一档低吸', () => {
  const klines = pullbackKlines(60, 100, 95)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const pullback = results.find((s) => s.id === 'pullback')
  approx(pullback.currentExposure, 0.33, 1e-9)
  assert.equal(pullback.currentAction, '第一档低吸')
})

test('pullback 策略：drawdown ≈ -11% → exposure = 0.66 → 第二档低吸', () => {
  const klines = pullbackKlines(60, 100, 89)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const pullback = results.find((s) => s.id === 'pullback')
  approx(pullback.currentExposure, 0.66, 1e-9)
  assert.equal(pullback.currentAction, '第二档低吸')
})

test('pullback 策略：drawdown = -15% → exposure = 1 → 第三档低吸', () => {
  const klines = pullbackKlines(60, 100, 85)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const pullback = results.find((s) => s.id === 'pullback')
  approx(pullback.currentExposure, 1, 1e-9)
  assert.equal(pullback.currentAction, '第三档低吸')
})

test('pullback 策略：close 站上 ma20 但无回撤 → exposure = 0.15 → 等待回撤', () => {
  const klines = pullbackKlines(60, 100, 100.5)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const pullback = results.find((s) => s.id === 'pullback')
  approx(pullback.currentExposure, 0.15, 1e-9)
  // exposure 0.15 < 0.3 阈值，仍归类为"等待回撤"
  assert.equal(pullback.currentAction, '等待回撤')
})

test('benchmarkMaxDrawdown 反映买入持有路径上的峰谷回撤', () => {
  const klines = pullbackKlines(60, 100, 80)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  results.forEach((strategy) => {
    approx(strategy.benchmarkMaxDrawdown, -0.2, 1e-9)
  })
  const buyHold = results.find((s) => s.id === 'buyHold')
  // buyHold 全程满仓，maxDrawdown 应等于 benchmark
  approx(buyHold.maxDrawdown, -0.2, 1e-9)
})

// ---- 交易成本模型 ----

// 构造一段会反复触发回撤档位切换、产生换手的行情：涨→急跌→反弹→再跌
function choppyKlines() {
  const out = []
  const start = new Date('2024-01-01')
  let day = 0
  const push = (close) => {
    const date = new Date(start)
    date.setDate(start.getDate() + day)
    out.push({ date: date.toISOString().slice(0, 10), close })
    day += 1
  }
  for (let i = 0; i < 70; i += 1) push(100) // 建立 60 日均线/高点
  for (let i = 0; i < 8; i += 1) push(88) // 跌破 -10% 档
  for (let i = 0; i < 8; i += 1) push(100) // 反弹回原位
  for (let i = 0; i < 8; i += 1) push(84) // 再跌破 -15% 档
  for (let i = 0; i < 8; i += 1) push(99) // 再反弹
  return out
}

test('交易成本：默认成本下主动策略产生 rebalanceCount 与正的 costDrag', () => {
  const klines = choppyKlines()
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  const pullback = results.find((s) => s.id === 'pullback')
  // 反复穿越回撤档位 → 必然多次调仓
  assert.ok(pullback.rebalanceCount > 0, `期望调仓次数 >0，实际 ${pullback.rebalanceCount}`)
  assert.ok(pullback.costDrag > 0, `期望成本拖累 >0，实际 ${pullback.costDrag}`)
})

test('交易成本：成本越高，主动策略 totalReturn 越低（成本被真正扣进净值）', () => {
  const klines = choppyKlines()
  const free = buildBacktestStrategies({
    klines,
    factorBaskets: baseFactorBaskets,
    costBpsPerSide: 0,
  }).find((s) => s.id === 'pullback')
  const cheap = buildBacktestStrategies({
    klines,
    factorBaskets: baseFactorBaskets,
    costBpsPerSide: 4,
  }).find((s) => s.id === 'pullback')
  const pricey = buildBacktestStrategies({
    klines,
    factorBaskets: baseFactorBaskets,
    costBpsPerSide: 50,
  }).find((s) => s.id === 'pullback')

  assert.equal(free.costDrag, 0, '零成本时 costDrag 必须为 0')
  assert.ok(cheap.costDrag > 0)
  assert.ok(pricey.costDrag > cheap.costDrag, '成本费率越高，累计成本越大')
  assert.ok(
    cheap.totalReturn < free.totalReturn,
    `加成本后收益应下降：free=${free.totalReturn} cheap=${cheap.totalReturn}`,
  )
  assert.ok(
    pricey.totalReturn < cheap.totalReturn,
    `成本越高收益越低：cheap=${cheap.totalReturn} pricey=${pricey.totalReturn}`,
  )
})

test('交易成本：买入持有作为基准线豁免交易成本（永不调仓）', () => {
  const klines = risingKlines(250, 0.001)
  const free = buildBacktestStrategies({
    klines,
    factorBaskets: baseFactorBaskets,
    costBpsPerSide: 0,
  }).find((s) => s.id === 'buyHold')
  const costed = buildBacktestStrategies({
    klines,
    factorBaskets: baseFactorBaskets,
    costBpsPerSide: 50,
  }).find((s) => s.id === 'buyHold')
  // 基准是其它策略的对照，自身不计成本：两种费率下结果完全一致
  approx(costed.totalReturn, free.totalReturn, 1e-12)
  approx(costed.annualReturn, free.annualReturn, 1e-12)
  assert.equal(costed.costDrag, 0)
  assert.equal(costed.rebalanceCount, 0)
})

test('交易成本：单调上涨中 trend 策略只建一次仓 → 成本拖累很小但非负', () => {
  const klines = risingKlines(250, 0.001)
  const trend = buildBacktestStrategies({
    klines,
    factorBaskets: baseFactorBaskets,
    costBpsPerSide: 4,
  }).find((s) => s.id === 'trend')
  // 持续上涨不触发降档，仅首次建仓一次换手
  assert.ok(trend.costDrag >= 0)
  assert.ok(trend.costDrag < 0.01, `单次建仓成本应很小，实际 ${trend.costDrag}`)
})

test('交易成本：样本不足时 costDrag 与 rebalanceCount 归零', () => {
  const klines = flatKlines(15)
  const results = buildBacktestStrategies({ klines, factorBaskets: baseFactorBaskets })
  results.forEach((strategy) => {
    assert.equal(strategy.costDrag, 0)
    assert.equal(strategy.rebalanceCount, 0)
  })
})
