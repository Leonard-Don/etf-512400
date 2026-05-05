import {
  cleanKlines,
  clamp,
  dailyReturns,
  movingAverage,
  realizedVolatilityFromReturns,
  scoreFromReturn,
  trailingHigh,
} from './math.js'

export function buildTrendProfile(klines) {
  const cleaned = cleanKlines(klines)

  if (cleaned.length < 2) {
    return {
      sampleSize: cleaned.length,
      state: '样本不足',
      score: 50,
      latestClose: cleaned.at(-1)?.close ?? null,
      return20: null,
      return60: null,
      drawdownFromHigh60: null,
      volatility: null,
    }
  }

  const latestIndex = cleaned.length - 1
  const latest = cleaned[latestIndex]
  const close = latest.close
  const ma20 = movingAverage(cleaned, latestIndex, 20)
  const ma60 = movingAverage(cleaned, latestIndex, 60)
  const high60 = trailingHigh(cleaned, latestIndex, 60)
  const return20 = latestIndex >= 20 ? close / cleaned[latestIndex - 20].close - 1 : null
  const return60 = latestIndex >= 60 ? close / cleaned[latestIndex - 60].close - 1 : null
  const drawdownFromHigh60 = high60 ? close / high60 - 1 : null
  const volatility = realizedVolatilityFromReturns(dailyReturns(cleaned).slice(-60))
  const momentumScore =
    0.55 * scoreFromReturn(return20, 260) +
    0.3 * scoreFromReturn(return60, 150) +
    0.15 * (ma20 && ma60 ? clamp(50 + (ma20 / ma60 - 1) * 900, 0, 100) : 50)
  const state =
    ma20 && ma60 && close > ma20 && ma20 > ma60
      ? '上升趋势'
      : ma60 && close < ma60
        ? '趋势转弱'
        : '震荡观察'

  return {
    sampleSize: cleaned.length,
    state,
    score: Math.round(momentumScore),
    latestDate: latest.date,
    latestClose: close,
    ma20,
    ma60,
    high60,
    return20,
    return60,
    drawdownFromHigh60,
    volatility,
  }
}
