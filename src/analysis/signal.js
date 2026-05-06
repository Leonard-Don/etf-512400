import {
  ADD_POSITION_GATES,
  COMPONENT_WEIGHTS,
  CONFIDENCE_BASE,
  CONFIDENCE_PER_POSITIVE_FACTOR,
  CONFIDENCE_PER_SAMPLE,
  CONFIDENCE_RANGE,
  DIP_BUY_GATES,
  DRAWDOWN_BONUS_CAP,
  DRAWDOWN_BONUS_SLOPE,
  FACTOR_BASELINE,
  FACTOR_RISK_DAMPEN,
  HIGH_RISK_FACTOR_PENALTY,
  LIQUIDITY_BASE,
  LIQUIDITY_SLOPE,
  POSITION,
  SCORE_TIERS,
  VALUATION_BASE,
  VALUATION_SLOPE,
  VETO,
  VOL_PENALTY_CAP,
  VOL_PENALTY_SLOPE,
  VOL_THRESHOLD,
} from '../config/thresholds.js'
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
  const factorScore = clamp(
    factorProfile.trendScore - factorProfile.riskScore * FACTOR_RISK_DAMPEN + FACTOR_BASELINE,
    0,
    100,
  )
  const valuationScore = clamp(VALUATION_BASE - premium * VALUATION_SLOPE, 0, 100)
  const liquidityScore = quote?.amountCny
    ? clamp(
        LIQUIDITY_BASE + Math.log10(Math.max(quote.amountCny, 1) / 100000000) * LIQUIDITY_SLOPE,
        20,
        95,
      )
    : 50
  const drawdownBonus = Number.isFinite(trendProfile.drawdownFromHigh60)
    ? clamp(
        Math.abs(Math.min(trendProfile.drawdownFromHigh60, 0)) * DRAWDOWN_BONUS_SLOPE,
        0,
        DRAWDOWN_BONUS_CAP,
      )
    : 0
  const riskPenalty =
    factorProfile.highRiskFactors * HIGH_RISK_FACTOR_PENALTY +
    (trendProfile.volatility && trendProfile.volatility > VOL_THRESHOLD
      ? clamp((trendProfile.volatility - VOL_THRESHOLD) * VOL_PENALTY_SLOPE, 0, VOL_PENALTY_CAP)
      : 0)

  let score = Math.round(
    clamp(
      momentumScore * COMPONENT_WEIGHTS.momentum +
        factorScore * COMPONENT_WEIGHTS.factor +
        valuationScore * COMPONENT_WEIGHTS.valuation +
        liquidityScore * COMPONENT_WEIGHTS.liquidity +
        riskBudget * COMPONENT_WEIGHTS.riskBudget +
        drawdownBonus -
        riskPenalty,
      0,
      100,
    ),
  )

  let action = '等待回落'
  let tone = 'neutral'

  if (
    score >= SCORE_TIERS.addPosition &&
    riskBudget >= ADD_POSITION_GATES.minRiskBudget &&
    factorProfile.highRiskFactors <= ADD_POSITION_GATES.maxHighRiskFactors
  ) {
    action = '分批加仓'
    tone = 'positive'
  } else if (score >= SCORE_TIERS.trackOnly) {
    action = '小仓跟踪'
    tone = 'positive'
  } else if (
    score >= SCORE_TIERS.dipBuy &&
    Number.isFinite(trendProfile.drawdownFromHigh60) &&
    trendProfile.drawdownFromHigh60 <= DIP_BUY_GATES.maxDrawdown &&
    factorProfile.trendScore >= DIP_BUY_GATES.minFactorTrendScore
  ) {
    action = '分批低吸'
    tone = 'opportunity'
  } else if (score <= SCORE_TIERS.riskOff || trendProfile.state === '趋势转弱') {
    action = '风险降档'
    tone = 'warning'
  }

  if (
    premium > VETO.premium ||
    dailyChange > VETO.dailyChange ||
    factorProfile.highRiskFactors >= VETO.highRiskFactors
  ) {
    score = Math.min(score, VETO.vetoCap)
    action = '禁止追高'
    tone = 'warning'
  }

  const exposureCap = clamp(riskBudget / 100, POSITION.capMin, POSITION.capMax)
  const suggestedExposure = clamp(
    ((score - POSITION.scoreFloor) / POSITION.scoreSpan) * exposureCap,
    0,
    exposureCap,
  )
  const confidence = Math.round(
    clamp(
      CONFIDENCE_BASE +
        trendProfile.sampleSize * CONFIDENCE_PER_SAMPLE +
        factorProfile.positiveFactors * CONFIDENCE_PER_POSITIVE_FACTOR -
        riskPenalty,
      CONFIDENCE_RANGE[0],
      CONFIDENCE_RANGE[1],
    ),
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
