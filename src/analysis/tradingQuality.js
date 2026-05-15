import { average, cleanKlines, clamp, realizedVolatilityFromReturns } from './math.js'

// 跟踪质量评分参数：deviation20/60 与 trackingError60 的惩罚权重
const TRACKING_SCORE = {
  base: 88,
  deviation20Penalty: 650,
  deviation60Penalty: 950,
  trackingErrorPenalty: 380,
  defaultTrackingError: 0.04, // trackingError60 缺失时的兜底
  scoreStable: 76,
  scoreAcceptable: 55,
  minSampleForGrading: 20,
}

// 折溢价温度：currentPremium 阈值 0.4%，z-score 阈值 1.4
const PREMIUM_TEMP = {
  hotPremium: 0.004,
  hotZ: 1.4,
  scoreBase: 90,
  premiumPenalty: 6500,
  zPenalty: 12,
}

// 流动性温度：成交额分位 + 20日比 + 换手
const LIQUIDITY_TEMP = {
  scoreBase: 34,
  percentileWeight: 0.48,
  ratio20Weight: 16,
  ratio20Cap: 2,
  turnoverWeight: 420,
  turnoverCap: 0.06,
  activePercentile: 70,
  activeRatio20: 0.9,
  shrinkPercentile: 30,
  shrinkRatio20: 0.7,
}

function cleanNavSeries(navSeries) {
  return navSeries
    .filter((item) => item.date && Number.isFinite(item.unit) && item.unit > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}

function trailingReturn(series, days, valueKey) {
  if (series.length <= days) return null
  const latest = series.at(-1)?.[valueKey]
  const base = series.at(-1 - days)?.[valueKey]
  if (!Number.isFinite(latest) || !Number.isFinite(base) || base <= 0) return null
  return latest / base - 1
}

function klineReturnMap(klines) {
  const cleaned = cleanKlines(klines)
  const result = new Map()

  cleaned.slice(1).forEach((item, index) => {
    const previous = cleaned[index]
    if (Number.isFinite(item.close) && Number.isFinite(previous.close) && previous.close > 0) {
      result.set(item.date, item.close / previous.close - 1)
    }
  })

  return result
}

function navReturnMap(navSeries) {
  const cleaned = cleanNavSeries(navSeries)
  const result = new Map()

  cleaned.forEach((item, index) => {
    if (Number.isFinite(item.dailyReturn)) {
      result.set(item.date, item.dailyReturn)
      return
    }

    const previous = cleaned[index - 1]
    if (previous?.unit > 0) result.set(item.date, item.unit / previous.unit - 1)
  })

  return result
}

function alignedReturnDiffs(assetReturns, benchmarkReturns) {
  const diffs = []

  assetReturns.forEach((assetReturn, date) => {
    const benchmarkReturn = benchmarkReturns.get(date)
    if (Number.isFinite(assetReturn) && Number.isFinite(benchmarkReturn)) {
      diffs.push(assetReturn - benchmarkReturn)
    }
  })

  return diffs
}

function sampleStd(values) {
  const valid = values.filter((item) => Number.isFinite(item))
  if (valid.length < 2) return null
  const mean = average(valid)
  const variance =
    valid.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (valid.length - 1)
  return Math.sqrt(variance)
}

function percentileRank(values, value) {
  const valid = values.filter((item) => Number.isFinite(item)).sort((a, b) => a - b)
  if (!valid.length || !Number.isFinite(value)) return null
  const belowOrEqual = valid.filter((item) => item <= value).length
  return Math.round((belowOrEqual / valid.length) * 100)
}

function finiteAverage(values, fallback = 50) {
  const value = average(values)
  return Number.isFinite(value) ? value : fallback
}

function difference(primary, benchmark) {
  if (!Number.isFinite(primary) || !Number.isFinite(benchmark)) return null
  return primary - benchmark
}

function buildTrackingQuality({ etfKlines, benchmarkKlines, navSeries }) {
  const etf = cleanKlines(etfKlines)
  const benchmark = cleanKlines(benchmarkKlines)
  const nav = cleanNavSeries(navSeries)
  const indexReturn20 = trailingReturn(benchmark, 20, 'close')
  const indexReturn60 = trailingReturn(benchmark, 60, 'close')
  const navReturn20 = trailingReturn(nav, 20, 'unit')
  const navReturn60 = trailingReturn(nav, 60, 'unit')
  const priceReturn20 = trailingReturn(etf, 20, 'close')
  const priceReturn60 = trailingReturn(etf, 60, 'close')
  const useNav = Number.isFinite(navReturn60)
  const primaryReturn20 = useNav ? navReturn20 : priceReturn20
  const primaryReturn60 = useNav ? navReturn60 : priceReturn60
  const benchmarkReturns = klineReturnMap(benchmark)
  let assetReturns = navReturnMap(nav)
  let basis = '净值'
  let trackingDiffs = alignedReturnDiffs(assetReturns, benchmarkReturns)

  if (trackingDiffs.length < 30) {
    assetReturns = klineReturnMap(etf)
    basis = '价格'
    trackingDiffs = alignedReturnDiffs(assetReturns, benchmarkReturns)
  }

  const trackingWindow = trackingDiffs.slice(-60)
  const trackingError60 =
    trackingWindow.length >= 20 ? realizedVolatilityFromReturns(trackingWindow) : null
  const deviation20 = difference(primaryReturn20, indexReturn20)
  const deviation60 = difference(primaryReturn60, indexReturn60)
  const rawScore =
    TRACKING_SCORE.base -
    Math.abs(deviation20 ?? 0) * TRACKING_SCORE.deviation20Penalty -
    Math.abs(deviation60 ?? 0) * TRACKING_SCORE.deviation60Penalty -
    (trackingError60 ?? TRACKING_SCORE.defaultTrackingError) * TRACKING_SCORE.trackingErrorPenalty
  const score = Math.round(clamp(rawScore, 0, 100))
  const status =
    trackingDiffs.length < TRACKING_SCORE.minSampleForGrading
      ? '样本不足'
      : score >= TRACKING_SCORE.scoreStable
        ? '跟踪稳'
        : score >= TRACKING_SCORE.scoreAcceptable
          ? '可接受'
          : '偏离放大'
  const tone = status === '偏离放大' ? 'warning' : status === '跟踪稳' ? 'positive' : 'neutral'

  return {
    basis,
    benchmarkName: '中证申万有色金属 000819',
    status,
    tone,
    score,
    sampleSize: trackingDiffs.length,
    trackingError60,
    deviation20,
    deviation60,
    indexReturn20,
    indexReturn60,
    navReturn20,
    navReturn60,
    priceReturn20,
    priceReturn60,
  }
}

function buildPremiumTemperature({ etfKlines, navSeries, price, nav }) {
  const etf = cleanKlines(etfKlines)
  const navByDate = new Map(cleanNavSeries(navSeries).map((item) => [item.date, item.unit]))
  const premiumSeries = etf
    .map((item) => {
      const navUnit = navByDate.get(item.date)
      return navUnit > 0 ? { date: item.date, premium: item.close / navUnit - 1 } : null
    })
    .filter(Boolean)
  const currentPremium =
    Number.isFinite(price) && Number.isFinite(nav) && nav > 0
      ? price / nav - 1
      : premiumSeries.at(-1)?.premium ?? null
  const latestDate = etf.at(-1)?.date ?? 'current'
  const mergedSeries = premiumSeries.filter((item) => item.date !== latestDate)

  if (Number.isFinite(currentPremium)) {
    mergedSeries.push({ date: latestDate, premium: currentPremium })
  }

  const window20 = mergedSeries.slice(-20).map((item) => item.premium)
  const average20 = average(window20)
  const std20 = sampleStd(window20)
  const zScore =
    Number.isFinite(currentPremium) && Number.isFinite(average20) && std20
      ? (currentPremium - average20) / std20
      : null
  const direction = currentPremium >= 0 ? 'premium' : 'discount'
  let streak = 0

  for (let index = mergedSeries.length - 1; index >= 0; index -= 1) {
    const itemDirection = mergedSeries[index].premium >= 0 ? 'premium' : 'discount'
    if (itemDirection !== direction) break
    streak += 1
  }

  // zScore 非有限（null/undefined/NaN/±Infinity）时按中性 0 处理：`?? 0` 只兜 nullish，
  // 会让 NaN/Infinity 漏到阈值比较和 score 惩罚里污染输出；合法数值 0 仍代表"恰好处于均值"。
  const safeZScore = Number.isFinite(zScore) ? zScore : 0
  const status =
    !Number.isFinite(currentPremium)
      ? '样本不足'
      : currentPremium > PREMIUM_TEMP.hotPremium || safeZScore > PREMIUM_TEMP.hotZ
        ? '溢价偏热'
        : currentPremium < -PREMIUM_TEMP.hotPremium || safeZScore < -PREMIUM_TEMP.hotZ
          ? '折价偏深'
          : '贴近净值'
  // currentPremium 缺失（null/NaN/Infinity）时 score=null，避免 `?? 0` 把"无数据"伪装成"零偏离=满分"，
  // 进而拉高 finiteAverage 计算的整体 tradingQuality.score；合法数值 0 仍按"贴近净值"打高分。
  const score = Number.isFinite(currentPremium)
    ? Math.round(
        clamp(
          PREMIUM_TEMP.scoreBase -
            Math.abs(currentPremium) * PREMIUM_TEMP.premiumPenalty -
            Math.abs(safeZScore) * PREMIUM_TEMP.zPenalty,
          0,
          100,
        ),
      )
    : null

  return {
    status,
    tone: status === '溢价偏热' ? 'warning' : status === '折价偏深' ? 'opportunity' : 'positive',
    score,
    currentPremium,
    average20,
    zScore,
    streak,
    streakLabel: `${streak}日${direction === 'premium' ? '溢价' : '折价'}`,
    sampleSize: mergedSeries.length,
  }
}

function buildLiquidityTemperature({ etfKlines, quote }) {
  const etf = cleanKlines(etfKlines)
  const latestAmount = quote?.amountCny ?? etf.at(-1)?.amount ?? null
  const amountWindow = etf
    .slice(-120)
    .map((item) => item.amount)
    .filter((item) => Number.isFinite(item))
  const amount20 = etf
    .slice(-20)
    .map((item) => item.amount)
    .filter((item) => Number.isFinite(item))
  const amount60 = etf
    .slice(-60)
    .map((item) => item.amount)
    .filter((item) => Number.isFinite(item))
  const amountPercentile = percentileRank(amountWindow, latestAmount)
  const average20 = average(amount20)
  const average60 = average(amount60)
  const amountRatio20 =
    Number.isFinite(latestAmount) && Number.isFinite(average20) && average20 > 0
      ? latestAmount / average20
      : null
  const score = Math.round(
    clamp(
      LIQUIDITY_TEMP.scoreBase +
        (amountPercentile ?? 50) * LIQUIDITY_TEMP.percentileWeight +
        Math.min(amountRatio20 ?? 1, LIQUIDITY_TEMP.ratio20Cap) * LIQUIDITY_TEMP.ratio20Weight +
        Math.min(quote?.turnoverRate ?? 0, LIQUIDITY_TEMP.turnoverCap) * LIQUIDITY_TEMP.turnoverWeight,
      0,
      100,
    ),
  )
  const status =
    amountPercentile === null
      ? '样本不足'
      : amountPercentile >= LIQUIDITY_TEMP.activePercentile &&
          (amountRatio20 ?? 1) >= LIQUIDITY_TEMP.activeRatio20
        ? '成交活跃'
        : amountPercentile <= LIQUIDITY_TEMP.shrinkPercentile ||
            (amountRatio20 ?? 1) < LIQUIDITY_TEMP.shrinkRatio20
          ? '成交收缩'
          : '正常换手'

  return {
    status,
    tone: status === '成交收缩' ? 'warning' : status === '成交活跃' ? 'positive' : 'neutral',
    score,
    latestAmount,
    amountPercentile,
    average20,
    average60,
    amountRatio20,
    turnoverRate: quote?.turnoverRate ?? null,
    sampleSize: amountWindow.length,
  }
}

export function buildTradingQualityProfile({
  etfKlines,
  benchmarkKlines,
  navSeries,
  price,
  nav,
  quote,
}) {
  const tracking = buildTrackingQuality({ etfKlines, benchmarkKlines, navSeries })
  const premium = buildPremiumTemperature({ etfKlines, navSeries, price, nav })
  const liquidity = buildLiquidityTemperature({ etfKlines, quote })
  const score = Math.round(finiteAverage([tracking.score, premium.score, liquidity.score]))
  let action = '交易质量正常'
  let tone = 'neutral'

  if (tracking.status === '偏离放大') {
    action = '先查跟踪偏离'
    tone = 'warning'
  } else if (premium.status === '溢价偏热') {
    action = '避免追价'
    tone = 'warning'
  } else if (liquidity.status === '成交收缩') {
    action = '降低单笔冲击'
    tone = 'warning'
  } else if (tracking.status === '跟踪稳' && premium.status === '贴近净值') {
    action = liquidity.status === '成交活跃' ? '交易质量良好' : '可正常执行'
    tone = 'positive'
  }

  const watchPoints = [
    `跟踪口径采用${tracking.basis}，样本 ${tracking.sampleSize} 日`,
    premium.status === '溢价偏热'
      ? '溢价偏热时优先限价，避免把短线噪音买成成本'
      : `折溢价 ${premium.status}，${premium.streakLabel}`,
    liquidity.status === '成交收缩'
      ? '成交额低位时拆单，避免临近收盘一次性成交'
      : `成交额处于近120日 ${liquidity.amountPercentile ?? '暂无'} 分位`,
  ]

  return {
    action,
    tone,
    score,
    tracking,
    premium,
    liquidity,
    watchPoints,
  }
}
