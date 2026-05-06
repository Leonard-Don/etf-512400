import { formatCnyAmount, formatSignedPercent } from './formatters.js'
import { buildFactorProfile, clamp } from './math.js'

// 综合分由 5 个分量加权合成，权重总和应为 1.0
const COMPONENT_WEIGHTS = {
  momentum: 0.34, // 趋势分量
  factor: 0.28, // 因子分量
  valuation: 0.16, // 估值分量
  liquidity: 0.12, // 流动性分量
  riskBudget: 0.1, // 用户当前的风险预算
}

// 决策档位阈值
const SCORE_TIERS = {
  addPosition: 72, // 加仓档，需满足风险预算 ≥55 且高风险因子 ≤2
  trackOnly: 62, // 小仓跟踪
  dipBuy: 52, // 分批低吸：需要回撤 ≤-6% 且趋势分 ≥55
  riskOff: 42, // 风险降档
}

// 否决（追高）规则：触发后分数被强制压到 vetoCap
const VETO = {
  premium: 0.008, // 折溢价 >0.8% 视作高估
  dailyChange: 0.045, // 单日涨幅 >4.5% 视作追高
  highRiskFactors: 3, // 高风险因子 ≥3 即否决
  vetoCap: 49,
}

// 仓位映射：综合分 35→仓位 0；100→仓位 = exposureCap
const POSITION = {
  scoreFloor: 35,
  scoreSpan: 65,
  capMin: 0.2,
  capMax: 0.8,
}

// 经验校准系数
const FACTOR_RISK_DAMPEN = 0.18 // 因子分中风险扣减权重
const FACTOR_BASELINE = 12 // 因子分基线偏移
const VALUATION_BASE = 58 // 折溢价 = 0 时的估值分
const VALUATION_SLOPE = 1800 // 折溢价每个百分点 → 估值分变化 18 分
const LIQUIDITY_BASE = 42 // 成交额 = 1 亿时的流动性分
const LIQUIDITY_SLOPE = 26 // 成交额每 10 倍 → 流动性分 +26
const DRAWDOWN_BONUS_SLOPE = 170 // 回撤每 1% → 加分 1.7
const DRAWDOWN_BONUS_CAP = 14
const HIGH_RISK_FACTOR_PENALTY = 4 // 每个高风险因子扣分
const VOL_THRESHOLD = 0.36 // 年化波动率超过此值开始扣分
const VOL_PENALTY_SLOPE = 45
const VOL_PENALTY_CAP = 12
const CONFIDENCE_BASE = 48
const CONFIDENCE_PER_SAMPLE = 0.12
const CONFIDENCE_PER_POSITIVE_FACTOR = 5
const CONFIDENCE_RANGE = [35, 86]

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

  if (score >= SCORE_TIERS.addPosition && riskBudget >= 55 && factorProfile.highRiskFactors <= 2) {
    action = '分批加仓'
    tone = 'positive'
  } else if (score >= SCORE_TIERS.trackOnly) {
    action = '小仓跟踪'
    tone = 'positive'
  } else if (
    score >= SCORE_TIERS.dipBuy &&
    Number.isFinite(trendProfile.drawdownFromHigh60) &&
    trendProfile.drawdownFromHigh60 <= -0.06 &&
    factorProfile.trendScore >= 55
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
