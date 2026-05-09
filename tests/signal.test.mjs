import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSignalEngine } from '../src/analysis/signal.js'

function trendProfile(overrides = {}) {
  return {
    state: '上升趋势',
    score: 70,
    sampleSize: 200,
    latestClose: 1.2,
    return20: 0.05,
    return60: 0.12,
    drawdownFromHigh60: -0.04,
    volatility: 0.3,
    ...overrides,
  }
}

const healthyFactors = [
  { trend: 70, risk: 40, weight: 30 },
  { trend: 65, risk: 50, weight: 30 },
  { trend: 60, risk: 55, weight: 20 },
  { trend: 55, risk: 45, weight: 20 },
]

const veryRiskyFactors = [
  { trend: 60, risk: 80, weight: 25 },
  { trend: 60, risk: 75, weight: 25 },
  { trend: 60, risk: 78, weight: 25 },
  { trend: 60, risk: 50, weight: 25 },
]

test('健康输入下不触发否决，给出非零仓位', () => {
  const result = buildSignalEngine({
    premium: 0.001,
    dailyChange: 0.01,
    riskBudget: 65,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 800_000_000 },
  })
  assert.notEqual(result.action, '禁止追高')
  assert.ok(result.suggestedExposure > 0, `期望 suggestedExposure>0，实际 ${result.suggestedExposure}`)
  assert.ok(result.score > 50, `期望 score>50，实际 ${result.score}`)
})

test('折溢价 >0.8% 触发否决', () => {
  const result = buildSignalEngine({
    premium: 0.012,
    dailyChange: 0.01,
    riskBudget: 65,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 800_000_000 },
  })
  assert.equal(result.action, '禁止追高')
  assert.equal(result.tone, 'warning')
  assert.ok(result.score <= 49, `vetoCap=49，实际 ${result.score}`)
})

test('单日涨幅 >4.5% 触发否决', () => {
  const result = buildSignalEngine({
    premium: 0,
    dailyChange: 0.05,
    riskBudget: 65,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 800_000_000 },
  })
  assert.equal(result.action, '禁止追高')
})

test('高风险因子 ≥3 触发否决', () => {
  const result = buildSignalEngine({
    premium: 0,
    dailyChange: 0,
    riskBudget: 70,
    factorBaskets: veryRiskyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 800_000_000 },
  })
  assert.equal(result.action, '禁止追高')
})

test('趋势转弱 + 低分 → 风险降档', () => {
  const result = buildSignalEngine({
    premium: 0,
    dailyChange: 0,
    riskBudget: 30,
    factorBaskets: [
      { trend: 30, risk: 40, weight: 50 },
      { trend: 35, risk: 45, weight: 50 },
    ],
    trendProfile: trendProfile({ state: '趋势转弱', score: 30, return20: -0.05, return60: -0.08 }),
    quote: { amountCny: 200_000_000 },
  })
  assert.equal(result.action, '风险降档')
  assert.equal(result.tone, 'warning')
})

test('风险预算决定仓位上限：60% 预算时仓位不超过 0.6', () => {
  const result = buildSignalEngine({
    premium: 0,
    dailyChange: 0.005,
    riskBudget: 60,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 1_500_000_000 },
  })
  assert.ok(
    result.suggestedExposure <= 0.6 + 1e-9,
    `期望 ≤0.6，实际 ${result.suggestedExposure}`,
  )
})

test('breakdown 包含四个分量且都在 [0,100]', () => {
  const result = buildSignalEngine({
    premium: 0.002,
    dailyChange: 0.01,
    riskBudget: 50,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 500_000_000 },
  })
  assert.equal(result.breakdown.length, 4)
  result.breakdown.forEach((item) => {
    assert.ok(item.value >= 0 && item.value <= 100, `${item.label}=${item.value} 超出 [0,100]`)
  })
})

// --- 边界 / 退化输入下的覆盖 ---

const liquidityValue = (result) =>
  result.breakdown.find((item) => item.label === '流动性').value
const valuationValue = (result) =>
  result.breakdown.find((item) => item.label === '估值').value

test('空 factorBaskets 不抛错，因子计数全部为 0', () => {
  const result = buildSignalEngine({
    premium: 0.001,
    dailyChange: 0.005,
    riskBudget: 50,
    factorBaskets: [],
    trendProfile: trendProfile(),
    quote: { amountCny: 500_000_000 },
  })
  assert.equal(result.factorProfile.highRiskFactors, 0)
  assert.equal(result.factorProfile.positiveFactors, 0)
  assert.notEqual(result.action, '禁止追高')
  assert.equal(result.breakdown.length, 4)
})

test('quote 缺失或 amountCny=0：流动性分量回退到 50', () => {
  const noQuote = buildSignalEngine({
    premium: 0,
    dailyChange: 0,
    riskBudget: 50,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: undefined,
  })
  const zeroAmount = buildSignalEngine({
    premium: 0,
    dailyChange: 0,
    riskBudget: 50,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 0 },
  })
  assert.equal(liquidityValue(noQuote), 50)
  assert.equal(liquidityValue(zeroAmount), 50)
})

test('极低成交额：流动性分量被夹紧到下限 20', () => {
  const result = buildSignalEngine({
    premium: 0,
    dailyChange: 0,
    riskBudget: 50,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 100 },
  })
  assert.equal(liquidityValue(result), 20)
})

test('drawdownFromHigh60 非有限值时不加 drawdown 加成', () => {
  const baseInputs = {
    premium: 0.005,
    dailyChange: 0,
    riskBudget: 25,
    factorBaskets: [
      { trend: 60, risk: 55, weight: 50 },
      { trend: 55, risk: 50, weight: 50 },
    ],
    quote: { amountCny: 100_000_000 },
  }
  const withBonus = buildSignalEngine({
    ...baseInputs,
    trendProfile: trendProfile({ score: 40, drawdownFromHigh60: -0.08 }),
  })
  const nanDrawdown = buildSignalEngine({
    ...baseInputs,
    trendProfile: trendProfile({ score: 40, drawdownFromHigh60: NaN }),
  })
  const undefDrawdown = buildSignalEngine({
    ...baseInputs,
    trendProfile: trendProfile({ score: 40, drawdownFromHigh60: undefined }),
  })
  assert.ok(
    withBonus.score > nanDrawdown.score,
    `期望 有回撤分数更高，得到 ${withBonus.score} vs ${nanDrawdown.score}`,
  )
  assert.equal(nanDrawdown.score, undefDrawdown.score)
})

test('折溢价正好等于 0.8% 不触发否决（条件为严格 >）', () => {
  const result = buildSignalEngine({
    premium: 0.008,
    dailyChange: 0.01,
    riskBudget: 65,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 800_000_000 },
  })
  assert.notEqual(result.action, '禁止追高')
})

test('单日涨幅正好等于 4.5% 不触发否决', () => {
  const result = buildSignalEngine({
    premium: 0,
    dailyChange: 0.045,
    riskBudget: 65,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 800_000_000 },
  })
  assert.notEqual(result.action, '禁止追高')
})

test('风险预算为 0 时仓位上限被夹紧到 0.2', () => {
  const result = buildSignalEngine({
    premium: 0,
    dailyChange: 0,
    riskBudget: 0,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 800_000_000 },
  })
  assert.ok(
    result.suggestedExposure <= 0.2 + 1e-9,
    `期望 ≤0.2，实际 ${result.suggestedExposure}`,
  )
  assert.ok(result.suggestedExposure >= 0)
})

test('波动率高于阈值会扣分（同条件下 score 更低）', () => {
  const lowVol = buildSignalEngine({
    premium: 0.001,
    dailyChange: 0.01,
    riskBudget: 65,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile({ volatility: 0.3 }),
    quote: { amountCny: 800_000_000 },
  })
  const highVol = buildSignalEngine({
    premium: 0.001,
    dailyChange: 0.01,
    riskBudget: 65,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile({ volatility: 0.6 }),
    quote: { amountCny: 800_000_000 },
  })
  assert.ok(
    highVol.score < lowVol.score,
    `期望 高波动 score 更低，得到 ${highVol.score} vs ${lowVol.score}`,
  )
})

test('confidence 在极端正向 / 极端负向输入下都被夹到 [35, 86]', () => {
  const high = buildSignalEngine({
    premium: 0,
    dailyChange: 0,
    riskBudget: 80,
    factorBaskets: [
      { trend: 90, risk: 30, weight: 25 },
      { trend: 90, risk: 30, weight: 25 },
      { trend: 90, risk: 30, weight: 25 },
      { trend: 90, risk: 30, weight: 25 },
    ],
    trendProfile: trendProfile({ sampleSize: 9999 }),
    quote: { amountCny: 800_000_000 },
  })
  const low = buildSignalEngine({
    premium: 0.05,
    dailyChange: 0.05,
    riskBudget: 0,
    factorBaskets: veryRiskyFactors,
    trendProfile: trendProfile({ sampleSize: 0, volatility: 1.5 }),
    quote: { amountCny: 100_000 },
  })
  assert.equal(high.confidence, 86)
  assert.equal(low.confidence, 35)
})

test('加仓档需要风险预算 ≥55，否则即使分数够也只是小仓跟踪', () => {
  const result = buildSignalEngine({
    premium: 0,
    dailyChange: 0.005,
    riskBudget: 50,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 1_500_000_000 },
  })
  assert.ok(result.score >= 72, `测试假设 score≥72，实际 ${result.score}`)
  assert.equal(result.action, '小仓跟踪')
  assert.equal(result.tone, 'positive')
})

test('极端折价 / 极端溢价：估值分量被夹紧到 [0, 100]', () => {
  const deepDiscount = buildSignalEngine({
    premium: -0.05,
    dailyChange: 0,
    riskBudget: 50,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 800_000_000 },
  })
  const deepPremium = buildSignalEngine({
    premium: 0.05,
    dailyChange: 0,
    riskBudget: 50,
    factorBaskets: healthyFactors,
    trendProfile: trendProfile(),
    quote: { amountCny: 800_000_000 },
  })
  assert.equal(valuationValue(deepDiscount), 100)
  assert.equal(valuationValue(deepPremium), 0)
})

test('score 在 [52, 62)、回撤够深、因子趋势够强 → 分批低吸', () => {
  const result = buildSignalEngine({
    premium: 0.005,
    dailyChange: 0,
    riskBudget: 25,
    factorBaskets: [
      { trend: 60, risk: 55, weight: 50 },
      { trend: 55, risk: 50, weight: 50 },
    ],
    trendProfile: trendProfile({ score: 40, drawdownFromHigh60: -0.08 }),
    quote: { amountCny: 100_000_000 },
  })
  assert.ok(
    result.score >= 52 && result.score < 62,
    `分批低吸档要求 [52,62)，实际 ${result.score}`,
  )
  assert.equal(result.action, '分批低吸')
  assert.equal(result.tone, 'opportunity')
})
