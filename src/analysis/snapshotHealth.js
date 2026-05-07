const DAY_MS = 24 * 60 * 60 * 1000

export function shanghaiDateString(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function dateToUtcDay(dateText) {
  if (!dateText || typeof dateText !== 'string') return null
  const [year, month, day] = dateText.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return Date.UTC(year, month - 1, day)
}

export function calendarDayGap(fromDate, toDate) {
  const from = dateToUtcDay(fromDate)
  const to = dateToUtcDay(toDate)
  if (from === null || to === null) return null
  return Math.round((to - from) / DAY_MS)
}

function sourceLabels(sources) {
  return sources
    .map((source) => source.label || source.id)
    .filter(Boolean)
    .join('、')
}

export function describeMarketStatus({ quoteTradeDate, statusCode, now = new Date() }) {
  if (!quoteTradeDate) return '行情日期未知'

  const today = shanghaiDateString(now)
  const tradeGap = calendarDayGap(quoteTradeDate, today)

  if (tradeGap === null) return `行情日 ${quoteTradeDate}`
  if (tradeGap <= 0) {
    return statusCode === 0 ? '今日行情待确认' : '今日行情已接入'
  }
  if (tradeGap === 1) return '行情停留在上一交易日'
  return `行情停留在 ${quoteTradeDate}`
}

export function buildDataFreshness({
  snapshotGeneratedAt,
  quoteTradeDate,
  navDate,
  sourceHealth = [],
  now = new Date(),
}) {
  const today = shanghaiDateString(now)
  const quoteGap = calendarDayGap(quoteTradeDate, today)
  const navGap = calendarDayGap(navDate, today)
  const failedSources = sourceHealth.filter((source) => source?.ok === false)
  const fallbackSources = failedSources.filter((source) => source.fallback)
  const requiredFailures = failedSources.filter((source) => source.required)

  let tone = 'good'
  let status = 'fresh'
  let summary = '数据已刷新'

  if (requiredFailures.length > 0) {
    tone = 'danger'
    status = 'degraded'
    summary = `核心源降级 ${requiredFailures.length} 个`
  } else if (failedSources.length > 0) {
    tone = 'warning'
    status = 'partial'
    summary = `辅助源降级 ${failedSources.length} 个`
  } else if ((quoteGap ?? 0) > 1 || (navGap ?? 0) > 1) {
    tone = 'warning'
    status = 'stale'
    summary = `行情停留在 ${quoteTradeDate ?? navDate ?? '旧快照'}`
  } else if ((quoteGap ?? 0) === 1 || (navGap ?? 0) === 1) {
    tone = 'good'
    status = 'previous_trade_day'
    summary = '上一交易日数据'
  }

  const details = []
  if (quoteGap !== null && quoteGap > 0) details.push(`行情距今天 ${quoteGap} 天`)
  if (navGap !== null && navGap > 0) details.push(`净值距今天 ${navGap} 天`)
  if (fallbackSources.length > 0) {
    const labels = sourceLabels(fallbackSources)
    details.push(labels ? `缓存源：${labels}` : `${fallbackSources.length} 个源使用缓存`)
  }
  const failedWithoutFallback = failedSources.filter((source) => !source.fallback)
  if (failedWithoutFallback.length > 0) {
    const labels = sourceLabels(failedWithoutFallback)
    details.push(labels ? `失败源：${labels}` : '存在无缓存失败源')
  }
  if (snapshotGeneratedAt) {
    details.push(`快照 ${snapshotGeneratedAt}`)
  }

  return {
    status,
    tone,
    summary,
    quoteAgeDays: quoteGap,
    navAgeDays: navGap,
    failedCount: failedSources.length,
    requiredFailedCount: requiredFailures.length,
    fallbackCount: fallbackSources.length,
    details,
  }
}
