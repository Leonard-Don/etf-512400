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
