import { formatPercent } from './formatters.js'
import {
  annualizedReturn,
  average,
  buildFactorProfile,
  cleanKlines,
  clamp,
  maxDrawdownFromCurve,
  movingAverage,
  trailingHigh,
} from './math.js'

function optimizedExposure(params, klines, index) {
  const close = klines[index].close
  const fastMa = movingAverage(klines, index, params.fastWindow)
  const slowMa = movingAverage(klines, index, params.slowWindow)
  const high = trailingHigh(klines, index, params.lookbackHigh)
  const drawdown = high ? close / high - 1 : 0
  const trendOn = fastMa && slowMa && close > fastMa && fastMa > slowMa
  const trendNeutral = slowMa && close > slowMa

  let exposure = 0

  if (trendOn) {
    exposure = 1
  } else if (trendNeutral) {
    exposure = 0.45
  }

  if (drawdown <= -params.deepPullback) {
    exposure = Math.max(exposure, 0.82)
  } else if (drawdown <= -params.entryPullback) {
    exposure = Math.max(exposure, 0.42)
  }

  if (drawdown <= -params.riskCut && slowMa && close < slowMa) {
    exposure = Math.min(exposure, 0.18)
  }

  return clamp(exposure, 0, 1)
}

function actionFromOptimizedExposure(exposure) {
  if (exposure >= 0.78) return '主仓持有'
  if (exposure >= 0.52) return '第二档配置'
  if (exposure >= 0.28) return '第一档低吸'
  if (exposure > 0) return '观察仓'
  return '空仓等待'
}

function evaluateBuyHold(klines, startIndex, endIndex) {
  const first = klines[startIndex]?.close
  const last = klines[endIndex]?.close
  if (!first || !last || endIndex <= startIndex) {
    return {
      annualReturn: 0,
      maxDrawdown: 0,
      totalReturn: 0,
      hitRate: 0,
      exposure: 1,
      emptyDays: 0,
    }
  }

  const curve = [1]
  let value = 1
  const returns = []
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    const dayReturn = klines[index].close / klines[index - 1].close - 1
    value *= 1 + dayReturn
    curve.push(value)
    returns.push(dayReturn)
  }

  return {
    annualReturn: annualizedReturn(value - 1, endIndex - startIndex),
    maxDrawdown: maxDrawdownFromCurve(curve),
    totalReturn: value - 1,
    hitRate: returns.length ? returns.filter((item) => item > 0).length / returns.length : 0,
    exposure: 1,
    emptyDays: 0,
  }
}

function evaluateOptimizedCandidate(klines, params, startIndex, endIndex) {
  const firstIndex = Math.max(startIndex + 1, params.slowWindow + 1)
  if (endIndex <= firstIndex) {
    return {
      annualReturn: 0,
      maxDrawdown: 0,
      totalReturn: 0,
      hitRate: 0,
      winLossRatio: 0,
      exposure: 0,
      emptyDays: 0,
      periods: 0,
    }
  }

  let value = 1
  const curve = [1]
  const activeReturns = []
  const exposures = []

  for (let index = firstIndex; index <= endIndex; index += 1) {
    const exposure = optimizedExposure(params, klines, index - 1)
    const dayReturn = klines[index].close / klines[index - 1].close - 1
    const strategyReturn = dayReturn * exposure
    value *= 1 + strategyReturn
    curve.push(value)
    exposures.push(exposure)
    if (exposure > 0.01) activeReturns.push(strategyReturn)
  }

  const gains = activeReturns.filter((item) => item > 0)
  const losses = activeReturns.filter((item) => item < 0)
  const averageGain = average(gains) ?? 0
  const averageLoss = Math.abs(average(losses) ?? 0)

  return {
    annualReturn: annualizedReturn(value - 1, endIndex - firstIndex + 1),
    maxDrawdown: maxDrawdownFromCurve(curve),
    totalReturn: value - 1,
    hitRate: activeReturns.length ? gains.length / activeReturns.length : 0,
    winLossRatio: averageLoss ? averageGain / averageLoss : 0,
    exposure: average(exposures) ?? 0,
    emptyDays: exposures.filter((item) => item < 0.1).length,
    periods: exposures.length,
  }
}

function generateOptimizerCandidates() {
  const fastWindows = [10, 15, 20, 25, 30]
  const slowWindows = [50, 60, 80, 100, 120]
  const entryPullbacks = [0.04, 0.05, 0.07, 0.08]
  const deepPullbacks = [0.1, 0.12, 0.15]
  const riskCuts = [0.16, 0.2, 0.24]
  const candidates = []

  fastWindows.forEach((fastWindow) => {
    slowWindows.forEach((slowWindow) => {
      if (slowWindow < fastWindow + 30) return
      entryPullbacks.forEach((entryPullback) => {
        deepPullbacks.forEach((deepPullback) => {
          if (deepPullback <= entryPullback + 0.03) return
          riskCuts.forEach((riskCut) => {
            candidates.push({
              fastWindow,
              slowWindow,
              entryPullback,
              deepPullback,
              riskCut,
              lookbackHigh: Math.max(60, slowWindow),
            })
          })
        })
      })
    })
  })

  return candidates
}

function scoreCandidate({ train, test, benchmarkTest, params }) {
  const trainTestGap = Math.abs(train.annualReturn - test.annualReturn)
  const drawdownGap = Math.abs(train.maxDrawdown - test.maxDrawdown)
  const exposurePenalty = test.exposure < 0.12 ? 16 : test.exposure > 0.88 ? 5 : 0
  const complexityPenalty = (params.fastWindow < 15 ? 3 : 0) + (params.slowWindow > 100 ? 2 : 0)
  const benchmarkBonus =
    test.annualReturn > benchmarkTest.annualReturn ? 10 : -Math.min(14, Math.abs(test.annualReturn - benchmarkTest.annualReturn) * 18)

  return (
    test.annualReturn * 88 +
    test.maxDrawdown * 72 +
    train.annualReturn * 18 +
    test.hitRate * 12 +
    Math.min(test.winLossRatio, 2) * 7 +
    benchmarkBonus -
    trainTestGap * 35 -
    drawdownGap * 70 -
    exposurePenalty -
    complexityPenalty
  )
}

function stabilityScoreFor(train, test, benchmarkTest) {
  const trainTestGap = Math.abs(train.annualReturn - test.annualReturn)
  const drawdownGap = Math.abs(train.maxDrawdown - test.maxDrawdown)
  const negativePenalty = test.annualReturn < 0 ? 28 : 0
  const benchmarkPenalty = test.annualReturn < benchmarkTest.annualReturn ? 10 : 0

  return Math.round(
    clamp(88 - trainTestGap * 42 - drawdownGap * 95 - negativePenalty - benchmarkPenalty, 0, 100),
  )
}

function overfitLabel(stabilityScore, train, test, sampleSize) {
  const gap = Math.abs(train.annualReturn - test.annualReturn)
  if (sampleSize < 360 && stabilityScore >= 70 && gap < 0.28 && test.annualReturn > 0) return '中'
  if (stabilityScore >= 70 && gap < 0.28 && test.annualReturn > 0) return '低'
  if (stabilityScore >= 48 && gap < 0.55) return '中'
  return '高'
}

function factorOverlayFor(factorProfile) {
  if (factorProfile.highRiskFactors >= 3) {
    return {
      multiplier: 0.5,
      note: '当前高风险因子达到3个，推荐仓位减半',
    }
  }

  if (factorProfile.positiveFactors >= 3 && factorProfile.highRiskFactors <= 1) {
    return {
      multiplier: 1.12,
      note: '当前因子共振较强，允许略微上调仓位',
    }
  }

  return {
    multiplier: 1,
    note: '当前因子不额外放大或压低仓位',
  }
}

function paramsLabel(params) {
  return `${params.fastWindow}/${params.slowWindow}日趋势，${Math.round(params.entryPullback * 100)}%/${Math.round(params.deepPullback * 100)}%回撤`
}

export function buildStrategyOptimizer({ klines, factorBaskets }) {
  const cleaned = cleanKlines(klines)
  const factorProfile = buildFactorProfile(factorBaskets)

  if (cleaned.length < 140) {
    return {
      ok: false,
      reason: 'K线样本不足，至少需要140个交易日',
      totalCandidates: 0,
      best: null,
      leaderboard: [],
    }
  }

  const splitIndex = Math.max(90, Math.floor(cleaned.length * 0.65))
  const trainStart = 0
  const trainEnd = splitIndex - 1
  const testStart = splitIndex - 1
  const testEnd = cleaned.length - 1
  const benchmarkTest = evaluateBuyHold(cleaned, testStart, testEnd)
  const candidates = generateOptimizerCandidates().map((params) => {
    const train = evaluateOptimizedCandidate(cleaned, params, trainStart, trainEnd)
    const test = evaluateOptimizedCandidate(cleaned, params, testStart, testEnd)
    const stabilityScore = Math.min(
      stabilityScoreFor(train, test, benchmarkTest),
      cleaned.length < 360 ? 78 : 100,
    )
    return {
      params,
      train,
      test,
      stabilityScore,
      overfitRisk: overfitLabel(stabilityScore, train, test, cleaned.length),
      score: scoreCandidate({ train, test, benchmarkTest, params }),
    }
  })

  const ranked = candidates
    .filter((candidate) => candidate.test.periods >= 35)
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  const latestRawExposure = optimizedExposure(best.params, cleaned, cleaned.length - 1)
  const factorOverlay = factorOverlayFor(factorProfile)
  const currentExposure = clamp(latestRawExposure * factorOverlay.multiplier, 0, 1)
  const action = actionFromOptimizedExposure(currentExposure)
  const tone =
    best.overfitRisk === '高'
      ? 'warning'
      : currentExposure >= 0.52
        ? 'positive'
        : currentExposure >= 0.25
          ? 'opportunity'
          : 'neutral'

  return {
    ok: true,
    totalCandidates: candidates.length,
    sample: {
      total: cleaned.length,
      train: trainEnd - trainStart + 1,
      test: testEnd - testStart + 1,
      splitDate: cleaned[splitIndex]?.date ?? cleaned[testStart]?.date,
      startDate: cleaned[0]?.date,
      endDate: cleaned.at(-1)?.date,
    },
    benchmarkTest,
    best: {
      ...best,
      label: paramsLabel(best.params),
      rule: `快线${best.params.fastWindow}日、慢线${best.params.slowWindow}日过滤趋势；回撤${formatPercent(best.params.entryPullback, 0)}先建观察仓，回撤${formatPercent(best.params.deepPullback, 0)}进入主仓；若回撤超过${formatPercent(best.params.riskCut, 0)}且价格低于慢线，仓位压到18%以内。`,
      current: {
        rawExposure: latestRawExposure,
        exposure: currentExposure,
        action,
        tone,
        factorOverlay: factorOverlay.multiplier,
        factorNote: factorOverlay.note,
      },
      invalidationRules: [
        '历史样本不足360个交易日时，过拟合风险最高只能评为中等',
        '样本外年化收益转负，自动规则降级为观察',
        '样本外最大回撤超过买入持有，停止放大仓位',
        '稳定性分数低于50，标记为过拟合风险偏高',
        '当前高风险因子达到3个及以上，仓位按风控覆盖下调',
      ],
    },
    leaderboard: ranked.slice(0, 5).map((candidate) => ({
      label: paramsLabel(candidate.params),
      score: candidate.score,
      stabilityScore: candidate.stabilityScore,
      overfitRisk: candidate.overfitRisk,
      testAnnualReturn: candidate.test.annualReturn,
      testMaxDrawdown: candidate.test.maxDrawdown,
      testExposure: candidate.test.exposure,
    })),
  }
}
