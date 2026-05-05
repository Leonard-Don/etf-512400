import { formatCnyAmount, formatSignedPercent } from './formatters.js'
import { buildFactorProfile, clamp } from './math.js'

export function buildSignalEngine({
  premium,
  dailyChange,
  riskBudget,
  factorBaskets,
  trendProfile,
  quote,
}) {
  const factorProfile = buildFactorProfile(factorBaskets)
  const momentumScore = trendProfile.score ?? 50
  const factorScore = clamp(factorProfile.trendScore - factorProfile.riskScore * 0.18 + 12, 0, 100)
  const valuationScore = clamp(58 - premium * 1800, 0, 100)
  const liquidityScore = quote?.amountCny
    ? clamp(42 + Math.log10(Math.max(quote.amountCny, 1) / 100000000) * 26, 20, 95)
    : 50
  const drawdownBonus = Number.isFinite(trendProfile.drawdownFromHigh60)
    ? clamp(Math.abs(Math.min(trendProfile.drawdownFromHigh60, 0)) * 170, 0, 14)
    : 0
  const riskPenalty =
    factorProfile.highRiskFactors * 4 +
    (trendProfile.volatility && trendProfile.volatility > 0.36
      ? clamp((trendProfile.volatility - 0.36) * 45, 0, 12)
      : 0)

  let score = Math.round(
    clamp(
      momentumScore * 0.34 +
        factorScore * 0.28 +
        valuationScore * 0.16 +
        liquidityScore * 0.12 +
        riskBudget * 0.1 +
        drawdownBonus -
        riskPenalty,
      0,
      100,
    ),
  )

  let action = '等待回落'
  let tone = 'neutral'

  if (score >= 72 && riskBudget >= 55 && factorProfile.highRiskFactors <= 2) {
    action = '分批加仓'
    tone = 'positive'
  } else if (score >= 62) {
    action = '小仓跟踪'
    tone = 'positive'
  } else if (
    score >= 52 &&
    Number.isFinite(trendProfile.drawdownFromHigh60) &&
    trendProfile.drawdownFromHigh60 <= -0.06 &&
    factorProfile.trendScore >= 55
  ) {
    action = '分批低吸'
    tone = 'opportunity'
  } else if (score <= 42 || trendProfile.state === '趋势转弱') {
    action = '风险降档'
    tone = 'warning'
  }

  if (premium > 0.008 || dailyChange > 0.045 || factorProfile.highRiskFactors >= 3) {
    score = Math.min(score, 49)
    action = '禁止追高'
    tone = 'warning'
  }

  const exposureCap = clamp(riskBudget / 100, 0.2, 0.8)
  const suggestedExposure = clamp(((score - 35) / 65) * exposureCap, 0, exposureCap)
  const confidence = Math.round(
    clamp(48 + trendProfile.sampleSize * 0.12 + factorProfile.positiveFactors * 5 - riskPenalty, 35, 86),
  )

  const reasons = [
    `趋势状态：${trendProfile.state}，20日${formatSignedPercent(trendProfile.return20, 1)}，60日${formatSignedPercent(trendProfile.return60, 1)}`,
    `因子状态：${factorProfile.positiveFactors}个因子向上，${factorProfile.highRiskFactors}个因子处于高风险`,
    `折溢价：${formatSignedPercent(premium, 2)}，成交额${formatCnyAmount(quote?.amountCny)}`,
  ]

  const invalidationRules = [
    '价格跌破60日均线且商品驱动没有修复，信号降为风险降档',
    '折溢价高于0.8%或单日急涨超过4.5%，禁止新增追价仓位',
    '高风险因子达到3个及以上，只保留观察仓或等待回撤',
  ]

  return {
    action,
    tone,
    score,
    suggestedExposure,
    confidence,
    factorProfile,
    breakdown: [
      { label: '趋势', value: Math.round(momentumScore) },
      { label: '因子', value: Math.round(factorScore) },
      { label: '估值', value: Math.round(valuationScore) },
      { label: '流动性', value: Math.round(liquidityScore) },
    ],
    reasons,
    invalidationRules,
  }
}
