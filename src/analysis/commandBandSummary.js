import { formatPercent, formatSignedPercent } from './formatters.js'
import { ADD_POSITION_GATES, VETO } from '../config/thresholds.js'

export function buildCommandBandSummary({
  dailyChange,
  dataFreshness,
  premium,
  primaryDecision,
  signal,
  trendProfile,
}) {
  const highRiskFactors = signal.factorProfile?.highRiskFactors ?? 0
  const blockers = []

  if (highRiskFactors >= VETO.highRiskFactors) {
    blockers.push(`高风险因子 ${highRiskFactors} 个，达到禁止追高线`)
  }
  if (premium > VETO.premium) {
    blockers.push(`折溢价 ${formatSignedPercent(premium, 2)}，高于 ${formatPercent(VETO.premium, 2)} 追高线`)
  }
  if (dailyChange > VETO.dailyChange) {
    blockers.push(`单日涨幅 ${formatSignedPercent(dailyChange, 2)}，高于 ${formatPercent(VETO.dailyChange, 2)} 追高线`)
  }
  if (dataFreshness?.tone && dataFreshness.tone !== 'good') {
    blockers.push(dataFreshness.summary)
  }

  const reason =
    blockers[0] ??
    signal.reasons?.[0] ??
    `${trendProfile.state}，信号分 ${signal.score}`
  const nextStep =
    primaryDecision.tone === 'warning'
      ? `等高风险因子≤${VETO.highRiskFactors - 1}，且折溢价/单日涨幅低于追高线`
      : `预算≥${ADD_POSITION_GATES.minRiskBudget}% 且高风险因子≤${ADD_POSITION_GATES.maxHighRiskFactors} 才考虑加仓`

  return {
    reason,
    nextStep,
  }
}
