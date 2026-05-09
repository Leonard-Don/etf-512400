// 把 snapshotHistory 数组里的原始快照记录归一化成回放面板用的固定字段：
// date / quote / premium / signal / decision / exposure / risk。归一化只做读路径，不改写源文件。

const HIGH_RISK_THRESHOLD = 80
const POSITIVE_TREND_THRESHOLD = 60
const VETO_PREMIUM = 0.008
const RISK_OFF_DRIVER_COUNT = 3
const ADD_POSITION_TREND = 70
const TRACK_POSITION_TREND = 50

const ACTION_EXPOSURE = {
  '分批加仓': 0.6,
  '小仓跟踪': 0.4,
  '等待回落': 0.2,
  '风险降档': 0.1,
  '禁止追高': 0.05,
}

const ACTION_TONE = {
  '分批加仓': 'positive',
  '小仓跟踪': 'positive',
  '等待回落': 'neutral',
  '风险降档': 'warning',
  '禁止追高': 'warning',
}

function roundTo(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}

function buildSignalAggregate(drivers) {
  const okDrivers = Array.isArray(drivers)
    ? drivers.filter((driver) => driver?.ok !== false && Number.isFinite(driver?.trendScore))
    : []

  if (!okDrivers.length) {
    return {
      avgTrend: 0,
      avgRisk: 0,
      driverCount: 0,
      highRiskCount: 0,
      positiveCount: 0,
    }
  }

  const trendSum = okDrivers.reduce((sum, driver) => sum + driver.trendScore, 0)
  const riskSum = okDrivers.reduce(
    (sum, driver) => sum + (Number.isFinite(driver.riskScore) ? driver.riskScore : 0),
    0,
  )
  const highRiskCount = okDrivers.filter(
    (driver) => Number.isFinite(driver.riskScore) && driver.riskScore >= HIGH_RISK_THRESHOLD,
  ).length
  const positiveCount = okDrivers.filter(
    (driver) => driver.trendScore >= POSITIVE_TREND_THRESHOLD,
  ).length

  return {
    avgTrend: roundTo(trendSum / okDrivers.length, 1),
    avgRisk: roundTo(riskSum / okDrivers.length, 1),
    driverCount: okDrivers.length,
    highRiskCount,
    positiveCount,
  }
}

function buildDecision(premium, signal) {
  if (Number.isFinite(premium) && premium > VETO_PREMIUM) {
    return { action: '禁止追高', tone: ACTION_TONE['禁止追高'] }
  }
  if (signal.highRiskCount >= RISK_OFF_DRIVER_COUNT) {
    return { action: '风险降档', tone: ACTION_TONE['风险降档'] }
  }
  if (signal.avgTrend >= ADD_POSITION_TREND) {
    return { action: '分批加仓', tone: ACTION_TONE['分批加仓'] }
  }
  if (signal.avgTrend >= TRACK_POSITION_TREND) {
    return { action: '小仓跟踪', tone: ACTION_TONE['小仓跟踪'] }
  }
  return { action: '等待回落', tone: ACTION_TONE['等待回落'] }
}

function buildRisk(drivers, signal) {
  const okDrivers = Array.isArray(drivers)
    ? drivers.filter((driver) => driver?.ok !== false && Number.isFinite(driver?.riskScore))
    : []
  const topDriver = okDrivers.length
    ? okDrivers.reduce((top, driver) => (driver.riskScore > top.riskScore ? driver : top))
    : null

  let tone = 'good'
  if (signal.highRiskCount >= RISK_OFF_DRIVER_COUNT) tone = 'danger'
  else if (signal.highRiskCount >= 1) tone = 'warning'

  return {
    tone,
    summary: `${signal.highRiskCount}/${signal.driverCount} 高风险`,
    topDriver: topDriver ? { key: topDriver.key, riskScore: topDriver.riskScore } : null,
  }
}

export function normalizeHistorySnapshot(record) {
  if (!record || typeof record !== 'object') return null
  if (!record.tradeDate) return null

  const signal = buildSignalAggregate(record.drivers)
  const premium = Number.isFinite(record.premium) ? record.premium : null
  const decision = buildDecision(premium, signal)
  const risk = buildRisk(record.drivers, signal)

  return {
    date: record.tradeDate,
    generatedAt: record.generatedAt ?? null,
    quote: {
      price: finiteOrNull(record.price),
      nav: finiteOrNull(record.nav),
      changePercent: finiteOrNull(record.changePercent),
      amountCny: finiteOrNull(record.amountCny),
      turnoverRate: finiteOrNull(record.turnoverRate),
      tradeTime: record.tradeTime ?? null,
    },
    premium,
    signal,
    decision,
    exposure: ACTION_EXPOSURE[decision.action],
    risk,
  }
}

export function normalizeHistoryArchive(records) {
  if (!Array.isArray(records)) return []
  return records
    .map(normalizeHistorySnapshot)
    .filter((entry) => entry !== null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
