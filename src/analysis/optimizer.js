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

// 仓位档位：满仓 / 中性 / 深度回撤抢反弹 / 浅回撤试探 / 风控压仓
const EXPOSURE_LEVELS = {
  trendFull: 1,
  trendNeutral: 0.45,
  deepPullback: 0.82,
  entryPullback: 0.42,
  riskCut: 0.18,
}

// 由仓位反推动作的阈值
const ACTION_THRESHOLDS = {
  main: 0.78,
  second: 0.52,
  first: 0.28,
}

// scoreCandidate：综合分加权（注意 maxDrawdown 为负，乘正数即扣分）
const SCORER = {
  testAnnualReturn: 88,
  testMaxDrawdown: 72,
  trainAnnualReturn: 18,
  testHitRate: 12,
  winLossRatio: 7,
  trainTestGap: 35,
  drawdownGap: 70,
  benchmarkBeatBonus: 10,
  benchmarkMissCap: 14,
  benchmarkMissSlope: 18,
  underExposurePenalty: 16, // 平均仓位 < 12%
  overExposurePenalty: 5, // 平均仓位 > 88%
  fastWindowComplexity: 3, // fastWindow < 15
  slowWindowComplexity: 2, // slowWindow > 100
}

// stabilityScoreFor：稳定性 = 88 - 训练/测试差距 - 回撤差距 - 负收益惩罚 - 输基准惩罚
const STABILITY = {
  base: 88,
  trainTestGapPenalty: 42,
  drawdownGapPenalty: 95,
  negativeReturnPenalty: 28,
  underBenchmarkPenalty: 10,
}

const OVERFIT = {
  shortSampleDays: 360, // 样本不足 360 → 稳定性最高只能评中
  lowGap: 0.28,
  midGap: 0.55,
  highStability: 70,
  midStability: 48,
}

const FACTOR_OVERLAY = {
  defensiveMultiplier: 0.5, // 高风险因子 ≥3 → 仓位减半
  expansionMultiplier: 1.12, // 因子共振强 → 上调仓位
  defensiveHighRiskMin: 3,
  expansionPositiveMin: 3,
  expansionHighRiskMax: 1,
}

const MIN_KLINE_SAMPLE = 140 // 至少需要的 K 线样本
const MIN_PERIODS_FOR_RANKING = 35 // 测试段交易日太少不参与排名
const STABILITY_CAP_SHORT_SAMPLE = 78 // 样本不足时稳定性的上限

const DEFAULT_PARAMETER_GRID = {
  fastWindows: [10, 15, 20, 25, 30],
  slowWindows: [50, 60, 80, 100, 120],
  entryPullbacks: [0.04, 0.05, 0.07, 0.08],
  deepPullbacks: [0.1, 0.12, 0.15],
  riskCuts: [0.16, 0.2, 0.24],
}

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
    exposure = EXPOSURE_LEVELS.trendFull
  } else if (trendNeutral) {
    exposure = EXPOSURE_LEVELS.trendNeutral
  }

  if (drawdown <= -params.deepPullback) {
    exposure = Math.max(exposure, EXPOSURE_LEVELS.deepPullback)
  } else if (drawdown <= -params.entryPullback) {
    exposure = Math.max(exposure, EXPOSURE_LEVELS.entryPullback)
  }

  if (drawdown <= -params.riskCut && slowMa && close < slowMa) {
    exposure = Math.min(exposure, EXPOSURE_LEVELS.riskCut)
  }

  return clamp(exposure, 0, 1)
}

function actionFromOptimizedExposure(exposure) {
  if (exposure >= ACTION_THRESHOLDS.main) return '主仓持有'
  if (exposure >= ACTION_THRESHOLDS.second) return '第二档配置'
  if (exposure >= ACTION_THRESHOLDS.first) return '第一档低吸'
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

function finiteGridValues(values, fallback) {
  const source = Array.isArray(values) && values.length ? values : fallback
  return [...new Set(source.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b)
}

function normalizeParameterGrid(parameterGrid = {}) {
  return {
    fastWindows: finiteGridValues(parameterGrid.fastWindows, DEFAULT_PARAMETER_GRID.fastWindows),
    slowWindows: finiteGridValues(parameterGrid.slowWindows, DEFAULT_PARAMETER_GRID.slowWindows),
    entryPullbacks: finiteGridValues(
      parameterGrid.entryPullbacks,
      DEFAULT_PARAMETER_GRID.entryPullbacks,
    ),
    deepPullbacks: finiteGridValues(parameterGrid.deepPullbacks, DEFAULT_PARAMETER_GRID.deepPullbacks),
    riskCuts: finiteGridValues(parameterGrid.riskCuts, DEFAULT_PARAMETER_GRID.riskCuts),
  }
}

function generateOptimizerCandidates(parameterGrid) {
  const { fastWindows, slowWindows, entryPullbacks, deepPullbacks, riskCuts } =
    normalizeParameterGrid(parameterGrid)
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
  const exposurePenalty =
    test.exposure < 0.12
      ? SCORER.underExposurePenalty
      : test.exposure > 0.88
        ? SCORER.overExposurePenalty
        : 0
  const complexityPenalty =
    (params.fastWindow < 15 ? SCORER.fastWindowComplexity : 0) +
    (params.slowWindow > 100 ? SCORER.slowWindowComplexity : 0)
  const benchmarkBonus =
    test.annualReturn > benchmarkTest.annualReturn
      ? SCORER.benchmarkBeatBonus
      : -Math.min(
          SCORER.benchmarkMissCap,
          Math.abs(test.annualReturn - benchmarkTest.annualReturn) * SCORER.benchmarkMissSlope,
        )

  return (
    test.annualReturn * SCORER.testAnnualReturn +
    test.maxDrawdown * SCORER.testMaxDrawdown +
    train.annualReturn * SCORER.trainAnnualReturn +
    test.hitRate * SCORER.testHitRate +
    Math.min(test.winLossRatio, 2) * SCORER.winLossRatio +
    benchmarkBonus -
    trainTestGap * SCORER.trainTestGap -
    drawdownGap * SCORER.drawdownGap -
    exposurePenalty -
    complexityPenalty
  )
}

function stabilityScoreFor(train, test, benchmarkTest) {
  const trainTestGap = Math.abs(train.annualReturn - test.annualReturn)
  const drawdownGap = Math.abs(train.maxDrawdown - test.maxDrawdown)
  const negativePenalty = test.annualReturn < 0 ? STABILITY.negativeReturnPenalty : 0
  const benchmarkPenalty =
    test.annualReturn < benchmarkTest.annualReturn ? STABILITY.underBenchmarkPenalty : 0

  return Math.round(
    clamp(
      STABILITY.base -
        trainTestGap * STABILITY.trainTestGapPenalty -
        drawdownGap * STABILITY.drawdownGapPenalty -
        negativePenalty -
        benchmarkPenalty,
      0,
      100,
    ),
  )
}

function overfitLabel(stabilityScore, train, test, sampleSize) {
  const gap = Math.abs(train.annualReturn - test.annualReturn)
  if (
    sampleSize < OVERFIT.shortSampleDays &&
    stabilityScore >= OVERFIT.highStability &&
    gap < OVERFIT.lowGap &&
    test.annualReturn > 0
  )
    return '中'
  if (stabilityScore >= OVERFIT.highStability && gap < OVERFIT.lowGap && test.annualReturn > 0)
    return '低'
  if (stabilityScore >= OVERFIT.midStability && gap < OVERFIT.midGap) return '中'
  return '高'
}

function factorOverlayFor(factorProfile) {
  if (factorProfile.highRiskFactors >= FACTOR_OVERLAY.defensiveHighRiskMin) {
    return {
      multiplier: FACTOR_OVERLAY.defensiveMultiplier,
      note: '当前高风险因子达到3个，推荐仓位减半',
    }
  }

  if (
    factorProfile.positiveFactors >= FACTOR_OVERLAY.expansionPositiveMin &&
    factorProfile.highRiskFactors <= FACTOR_OVERLAY.expansionHighRiskMax
  ) {
    return {
      multiplier: FACTOR_OVERLAY.expansionMultiplier,
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

function numberRange(values) {
  const valid = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!valid.length) return null
  return {
    min: valid[0],
    max: valid.at(-1),
    values: [...new Set(valid)],
  }
}

function rangeLabel(range, formatter = (value) => `${value}`) {
  if (!range) return '暂无'
  if (range.min === range.max) return formatter(range.min)
  return `${formatter(range.min)} - ${formatter(range.max)}`
}

function standardDeviation(values) {
  const valid = values.filter((value) => Number.isFinite(value))
  if (valid.length < 2) return 0
  const mean = average(valid)
  return Math.sqrt(valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length)
}

function buildParameterSurface(ranked, candidates, benchmarkTest) {
  if (!ranked.length) {
    return {
      candidateCount: candidates.length,
      validCount: 0,
      validCoverage: 0,
      stableCount: 0,
      stableCoverage: 0,
      stabilityScore: 0,
      scoreDispersion: 0,
      recommended: null,
      stableZone: null,
      topWindows: [],
      warnings: ['没有候选通过样本外交易日门槛，无法形成参数表面'],
    }
  }

  const topCutoffIndex = Math.max(0, Math.min(ranked.length - 1, Math.ceil(ranked.length * 0.12) - 1))
  const cutoffScore = ranked[topCutoffIndex].score
  const topCohort = ranked.filter((candidate) => candidate.score >= cutoffScore - 1e-9)
  const robustCandidates = ranked.filter(
    (candidate) =>
      candidate.stabilityScore >= 62 &&
      candidate.overfitRisk !== '高' &&
      candidate.test.annualReturn >= benchmarkTest.annualReturn - 0.02,
  )
  const stableCohort = topCohort.filter(
    (candidate) => candidate.stabilityScore >= 58 && candidate.overfitRisk !== '高',
  )
  const zoneCohort = stableCohort.length ? stableCohort : topCohort
  const recommended = [...zoneCohort].sort(
    (a, b) => b.stabilityScore - a.stabilityScore || b.score - a.score,
  )[0]
  const scoreDispersion = standardDeviation(topCohort.map((candidate) => candidate.score))
  const stabilityScore = Math.round(average(zoneCohort.map((candidate) => candidate.stabilityScore)) ?? 0)
  const validCoverage = candidates.length ? ranked.length / candidates.length : 0
  const stableCoverage = ranked.length ? robustCandidates.length / ranked.length : 0

  const windowBuckets = new Map()
  ranked.forEach((candidate) => {
    const key = `${candidate.params.fastWindow}/${candidate.params.slowWindow}`
    const bucket = windowBuckets.get(key) ?? {
      label: `${key}日`,
      count: 0,
      scores: [],
      stabilities: [],
      returns: [],
    }
    bucket.count += 1
    bucket.scores.push(candidate.score)
    bucket.stabilities.push(candidate.stabilityScore)
    bucket.returns.push(candidate.test.annualReturn)
    windowBuckets.set(key, bucket)
  })

  const topWindows = [...windowBuckets.values()]
    .map((bucket) => ({
      label: bucket.label,
      count: bucket.count,
      averageScore: average(bucket.scores) ?? 0,
      stabilityScore: Math.round(average(bucket.stabilities) ?? 0),
      annualReturn: average(bucket.returns) ?? 0,
    }))
    .sort((a, b) => b.averageScore - a.averageScore)
    .slice(0, 4)

  const stableZone = {
    fastWindow: numberRange(zoneCohort.map((candidate) => candidate.params.fastWindow)),
    slowWindow: numberRange(zoneCohort.map((candidate) => candidate.params.slowWindow)),
    entryPullback: numberRange(zoneCohort.map((candidate) => candidate.params.entryPullback)),
    deepPullback: numberRange(zoneCohort.map((candidate) => candidate.params.deepPullback)),
    riskCut: numberRange(zoneCohort.map((candidate) => candidate.params.riskCut)),
    candidateCount: zoneCohort.length,
    label: `${rangeLabel(
      numberRange(zoneCohort.map((candidate) => candidate.params.fastWindow)),
    )}/${rangeLabel(
      numberRange(zoneCohort.map((candidate) => candidate.params.slowWindow)),
    )}日趋势，${rangeLabel(
      numberRange(zoneCohort.map((candidate) => candidate.params.entryPullback)),
      (value) => formatPercent(value, 0),
    )}/${rangeLabel(
      numberRange(zoneCohort.map((candidate) => candidate.params.deepPullback)),
      (value) => formatPercent(value, 0),
    )}回撤`,
  }

  const warnings = []
  if (stableCoverage < 0.08) warnings.push('稳健候选占比偏低，单点最优容易受样本切分影响')
  if (scoreDispersion > 8) warnings.push('头部候选分数离散度高，参数表面存在尖峰')
  if (ranked[0].overfitRisk === '高') warnings.push('分数最高参数已被标记为高过拟合风险')
  if (recommended && recommended.label !== ranked[0].label) {
    warnings.push('推荐配置优先采用稳定性更高的邻近参数，而非单点最高分')
  }
  if (!warnings.length) warnings.push('头部参数形成可解释稳定区间，暂未发现明显尖峰脆弱区')

  return {
    candidateCount: candidates.length,
    validCount: ranked.length,
    validCoverage,
    stableCount: robustCandidates.length,
    stableCoverage,
    stabilityScore,
    scoreDispersion,
    recommended: recommended
      ? {
          label: paramsLabel(recommended.params),
          params: recommended.params,
          score: recommended.score,
          stabilityScore: recommended.stabilityScore,
          overfitRisk: recommended.overfitRisk,
          testAnnualReturn: recommended.test.annualReturn,
          testMaxDrawdown: recommended.test.maxDrawdown,
          testExposure: recommended.test.exposure,
        }
      : null,
    stableZone,
    topWindows,
    warnings,
  }
}

export function buildStrategyOptimizer({ klines, factorBaskets, parameterGrid }) {
  const cleaned = cleanKlines(klines)
  const factorProfile = buildFactorProfile(factorBaskets)

  if (cleaned.length < MIN_KLINE_SAMPLE) {
    return {
      ok: false,
      reason: `K线样本不足，至少需要${MIN_KLINE_SAMPLE}个交易日`,
      totalCandidates: 0,
      best: null,
      leaderboard: [],
    }
  }

  const splitIndex = Math.max(90, Math.floor(cleaned.length * 0.65))
  const trainStart = 0
  const trainEnd = splitIndex - 1
  const testStart = splitIndex
  const testEnd = cleaned.length - 1
  const benchmarkTest = evaluateBuyHold(cleaned, testStart, testEnd)
  const candidates = generateOptimizerCandidates(parameterGrid).map((params) => {
    const train = evaluateOptimizedCandidate(cleaned, params, trainStart, trainEnd)
    const test = evaluateOptimizedCandidate(cleaned, params, testStart, testEnd)
    const stabilityScore = Math.min(
      stabilityScoreFor(train, test, benchmarkTest),
      cleaned.length < OVERFIT.shortSampleDays ? STABILITY_CAP_SHORT_SAMPLE : 100,
    )
    return {
      params,
      train,
      test,
      stabilityScore,
      overfitRisk: overfitLabel(stabilityScore, train, test, cleaned.length),
      score: scoreCandidate({ train, test, benchmarkTest, params }),
      label: paramsLabel(params),
    }
  })

  const ranked = candidates
    .filter((candidate) => candidate.test.periods >= MIN_PERIODS_FOR_RANKING)
    .sort((a, b) => b.score - a.score)

  if (!ranked.length) {
    return {
      ok: false,
      reason: `没有候选策略通过样本外门槛（至少 ${MIN_PERIODS_FOR_RANKING} 个测试日）`,
      totalCandidates: candidates.length,
      best: null,
      leaderboard: [],
    }
  }

  const best = ranked[0]
  const parameterSurface = buildParameterSurface(ranked, candidates, benchmarkTest)
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
    parameterSurface,
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
      label: candidate.label,
      score: candidate.score,
      stabilityScore: candidate.stabilityScore,
      overfitRisk: candidate.overfitRisk,
      testAnnualReturn: candidate.test.annualReturn,
      testMaxDrawdown: candidate.test.maxDrawdown,
      testExposure: candidate.test.exposure,
    })),
  }
}
