import {
  average,
  buildFactorProfile,
  cleanKlines,
  maxDrawdownFromCurve,
  annualizedReturn,
  movingAverage,
  trailingHigh,
} from './math.js'
import { bpsToRate, normalizeCostBpsPerSide, rebalanceCost } from './backtestCost.js'

function strategyExposure(strategyId, klines, index, factorProfile) {
  const close = klines[index].close
  const ma20 = movingAverage(klines, index, 20)
  const ma60 = movingAverage(klines, index, 60)
  const high60 = trailingHigh(klines, index, 60)
  const drawdown = high60 ? close / high60 - 1 : 0

  if (strategyId === 'buyHold') return 1

  if (strategyId === 'trend') {
    if (!ma60) return 0.5
    if (close > ma20 && ma20 > ma60) return 1
    if (close > ma60) return 0.55
    return 0
  }

  if (strategyId === 'pullback') {
    if (drawdown <= -0.15) return 1
    if (drawdown <= -0.1) return 0.66
    if (drawdown <= -0.05) return 0.33
    if (ma20 && close > ma20) return 0.15
    return 0
  }

  if (strategyId === 'factor') {
    const factorGate = factorProfile.trendScore >= 58 && factorProfile.highRiskFactors <= 2
    if (!ma60) return factorGate ? 0.4 : 0
    if (factorGate && close > ma20 && ma20 > ma60) return 0.82
    if (factorGate && close > ma60) return 0.45
    return 0
  }

  return 0
}

function actionFromExposure(strategyId, exposure) {
  if (strategyId === 'buyHold') return '被动持有'
  if (strategyId === 'pullback') {
    if (exposure >= 0.9) return '第三档低吸'
    if (exposure >= 0.6) return '第二档低吸'
    if (exposure >= 0.3) return '第一档低吸'
    return '等待回撤'
  }
  if (strategyId === 'factor') {
    if (exposure >= 0.8) return '因子加仓'
    if (exposure > 0) return '小仓跟踪'
    return '因子未共振'
  }
  if (exposure >= 0.9) return '趋势持有'
  if (exposure > 0) return '观察仓'
  return '空仓等待'
}

function runBacktest(klines, strategy, factorProfile, costRate) {
  const cleaned = cleanKlines(klines)

  if (cleaned.length < 22) {
    return {
      ...strategy,
      annualReturn: 0,
      maxDrawdown: 0,
      hitRate: 0,
      winLossRatio: 0,
      exposure: 0,
      emptyDays: 0,
      currentAction: '样本不足',
      sampleSize: cleaned.length,
      benchmarkAnnualReturn: 0,
      rebalanceCount: 0,
      costDrag: 0,
    }
  }

  let strategyValue = 1
  let benchmarkValue = 1
  const curve = [1]
  const benchmarkCurve = [1]
  const exposures = []
  const activeReturns = []
  // 上一根 K 线持有的仓位。第 0 根之前视为空仓，首次建仓也会被计入换手成本。
  let previousExposure = 0
  let rebalanceCount = 0
  let totalCost = 0
  // 买入持有是「基准线」：全程满仓、永不调仓，它本身就是其它策略对照的零成本参照，
  // 因此基准不计交易成本（否则等于让基准与自己比较时被额外罚分，口径不一致）。
  const effectiveCostRate = strategy.id === 'buyHold' ? 0 : costRate

  for (let index = 1; index < cleaned.length; index += 1) {
    const exposure = strategyExposure(strategy.id, cleaned, index - 1, factorProfile)
    const dayReturn = cleaned[index].close / cleaned[index - 1].close - 1
    // 调仓成本：从 previousExposure 调到 exposure 的换手，按单边费率扣当期收益。
    // 仓位在 index-1 收盘决策、index 当根生效，成本与该根收益一并结算，不引入未来信息。
    const cost = rebalanceCost(previousExposure, exposure, effectiveCostRate)
    if (cost > 0) rebalanceCount += 1
    totalCost += cost
    const strategyReturn = dayReturn * exposure - cost
    strategyValue *= 1 + strategyReturn
    benchmarkValue *= 1 + dayReturn
    curve.push(strategyValue)
    benchmarkCurve.push(benchmarkValue)
    exposures.push(exposure)
    if (Math.abs(exposure) > 0.01) activeReturns.push(strategyReturn)
    previousExposure = exposure
  }

  const gains = activeReturns.filter((item) => item > 0)
  const losses = activeReturns.filter((item) => item < 0)
  const averageGain = average(gains) ?? 0
  const averageLoss = Math.abs(average(losses) ?? 0)
  const latestExposure = strategyExposure(strategy.id, cleaned, cleaned.length - 1, factorProfile)

  return {
    ...strategy,
    annualReturn: annualizedReturn(strategyValue - 1, cleaned.length - 1),
    maxDrawdown: maxDrawdownFromCurve(curve),
    hitRate: activeReturns.length ? gains.length / activeReturns.length : 0,
    winLossRatio: averageLoss ? averageGain / averageLoss : 0,
    exposure: average(exposures) ?? 0,
    emptyDays: exposures.filter((item) => item < 0.1).length,
    currentAction: actionFromExposure(strategy.id, latestExposure),
    currentExposure: latestExposure,
    sampleSize: cleaned.length,
    totalReturn: strategyValue - 1,
    benchmarkAnnualReturn: annualizedReturn(benchmarkValue - 1, cleaned.length - 1),
    benchmarkMaxDrawdown: maxDrawdownFromCurve(benchmarkCurve),
    rebalanceCount,
    costDrag: totalCost,
  }
}

export function buildBacktestStrategies({ klines, factorBaskets, costBpsPerSide }) {
  const factorProfile = buildFactorProfile(factorBaskets)
  // 单边交易成本：调用方可覆盖，默认取 A股 ETF 的保守口径（~4 bps/边）。
  const costRate = bpsToRate(normalizeCostBpsPerSide(costBpsPerSide))
  const strategies = [
    {
      id: 'buyHold',
      name: '买入持有',
      rule: '全程持有512400，作为所有主动规则的基准线',
    },
    {
      id: 'trend',
      name: '趋势跟随',
      rule: '收盘价站上20日与60日均线才满仓，跌破60日均线降为空仓',
    },
    {
      id: 'pullback',
      name: '回撤低吸',
      rule: '距离60日高点回撤5%、10%、15%分三档进入',
    },
    {
      id: 'factor',
      name: '因子共振',
      rule: '价格趋势与商品因子同时向上，且高风险因子不超过2个才加仓',
    },
  ]

  return strategies.map((strategy) => runBacktest(klines, strategy, factorProfile, costRate))
}
