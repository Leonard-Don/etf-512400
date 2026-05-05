export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function average(values) {
  const valid = values.filter((item) => Number.isFinite(item))
  if (!valid.length) return null
  return valid.reduce((sum, item) => sum + item, 0) / valid.length
}

export function movingAverage(klines, endIndex, days) {
  if (endIndex < days - 1) return null
  return average(klines.slice(endIndex - days + 1, endIndex + 1).map((item) => item.close))
}

export function trailingHigh(klines, endIndex, days) {
  const start = Math.max(0, endIndex - days + 1)
  const highs = klines.slice(start, endIndex + 1).map((item) => item.close)
  return Math.max(...highs)
}

export function dailyReturns(klines) {
  return klines.slice(1).map((item, index) => item.close / klines[index].close - 1)
}

export function cleanKlines(klines) {
  return klines
    .filter((item) => Number.isFinite(item.close))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}

export function realizedVolatilityFromReturns(returns) {
  if (returns.length < 2) return null
  const mean = average(returns)
  const variance =
    returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252)
}

export function maxDrawdownFromCurve(curve) {
  let peak = curve[0] ?? 1
  let maxDrawdown = 0

  curve.forEach((value) => {
    peak = Math.max(peak, value)
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, value / peak - 1)
  })

  return maxDrawdown
}

export function annualizedReturn(totalReturn, periods) {
  if (periods <= 0 || totalReturn <= -1) return 0
  return (1 + totalReturn) ** (252 / periods) - 1
}

export function scoreFromReturn(value, scale) {
  if (!Number.isFinite(value)) return 50
  return clamp(50 + value * scale, 0, 100)
}

export function buildFactorProfile(factorBaskets) {
  const totalWeight = factorBaskets.reduce((sum, factor) => sum + factor.weight, 0) || 1
  const trendScore =
    factorBaskets.reduce((sum, factor) => sum + factor.trend * factor.weight, 0) / totalWeight
  const riskScore =
    factorBaskets.reduce((sum, factor) => sum + factor.risk * factor.weight, 0) / totalWeight
  const positiveFactors = factorBaskets.filter((factor) => factor.trend >= 65).length
  const highRiskFactors = factorBaskets.filter((factor) => factor.risk >= 70).length

  return {
    trendScore,
    riskScore,
    positiveFactors,
    highRiskFactors,
  }
}
