// 把"今日决策台 → 信号 → 跟踪质量"的解释链合成一份精简研究备忘录。
// 纯函数：仅依赖已有 analysis 输出，不读数据、不跑指标，方便复用到导出/分享/智能体提示词。

function cloneReplaySelection(replaySelection) {
  if (replaySelection === null || replaySelection === undefined) return null
  const availableDates = Array.isArray(replaySelection.availableDates)
    ? [...replaySelection.availableDates]
    : []
  return {
    requestedAsOf: replaySelection.requestedAsOf ?? null,
    matchedDate: replaySelection.matchedDate ?? null,
    fallbackReason: replaySelection.fallbackReason ?? null,
    availableDates,
  }
}

export function composeResearchMemo({
  primaryDecision,
  signal,
  tradingQuality,
  trendProfile,
  premium,
  dailyChange,
  replaySelection = null,
}) {
  const exposurePercent = Math.round((primaryDecision.exposure ?? 0) * 100)
  const headline = `${primaryDecision.action}（仓位 ${exposurePercent}%）`

  const drivers = [
    `信号 ${signal.action}（${signal.score}）`,
    `交易质量 ${tradingQuality.action}（${tradingQuality.score}）`,
    `趋势 ${trendProfile.state}`,
  ]

  const reasons = [
    ...(signal.reasons ?? []),
    ...(tradingQuality.watchPoints ?? []),
  ]

  const invalidations = [...(signal.invalidationRules ?? [])]

  return {
    headline,
    drivers,
    reasons,
    invalidations,
    metrics: {
      score: primaryDecision.score,
      exposure: primaryDecision.exposure,
      confidence: signal.confidence,
      premium,
      dailyChange,
    },
    source: primaryDecision.source,
    rule: primaryDecision.rule,
    tone: primaryDecision.tone,
    replaySelection: cloneReplaySelection(replaySelection),
  }
}
