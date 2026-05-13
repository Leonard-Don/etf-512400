const DAY_MS = 24 * 60 * 60 * 1000
const STALE_SNAPSHOT_DAYS = 3

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

function sourceLabel(source) {
  return source?.label || source?.id || '未命名源'
}

function timestampDayGap(timestamp, now) {
  if (!timestamp) return null
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return null
  return calendarDayGap(shanghaiDateString(parsed), shanghaiDateString(now))
}

function coverageRatioFor(source) {
  if (Number.isFinite(source?.okCount) && Number.isFinite(source?.total) && source.total > 0) {
    return Math.max(0, Math.min(1, source.okCount / source.total))
  }
  return source?.ok === false ? 0 : 1
}

function providerStatusFor(source) {
  if (source?.ok) return source?.runtime ? 'runtime' : 'ok'
  if (source?.fallback) return 'fallback'
  return 'failed'
}

function providerBadgeFor(status, ageDays) {
  if (status === 'failed') return '失败'
  if (status === 'fallback') return '缓存'
  if (ageDays !== null && ageDays > STALE_SNAPSHOT_DAYS) return '过旧'
  if (status === 'runtime') return '实时'
  return '正常'
}

export function buildProviderFreshnessRegistry({
  sourceHealth = [],
  quoteTradeDate,
  navDate,
  snapshotGeneratedAt,
  now = new Date(),
} = {}) {
  const snapshotAgeDays = timestampDayGap(snapshotGeneratedAt, now)
  const quoteAgeDays = calendarDayGap(quoteTradeDate, shanghaiDateString(now))
  const navAgeDays = calendarDayGap(navDate, shanghaiDateString(now))

  const providers = sourceHealth.map((source) => {
    const status = providerStatusFor(source)
    const fetchedAgeDays = timestampDayGap(source?.fetchedAt, now)
    const domainAgeDays =
      source?.id === 'quote'
        ? quoteAgeDays
        : source?.id === 'fundTrend' || source?.id === 'fundGauge'
          ? navAgeDays
          : null
    const ageDays = domainAgeDays ?? fetchedAgeDays ?? snapshotAgeDays
    const coverageRatio = coverageRatioFor(source)
    const fallbackReason =
      source?.error ??
      (source?.fallback ? '使用缓存或本地快照兜底' : status === 'failed' ? '源未返回可用数据' : '')

    return {
      id: source?.id ?? sourceLabel(source),
      label: sourceLabel(source),
      required: Boolean(source?.required),
      status,
      badge: providerBadgeFor(status, ageDays),
      ok: source?.ok !== false,
      fallback: Boolean(source?.fallback),
      runtime: Boolean(source?.runtime),
      coverageRatio,
      coveragePercent: Math.round(coverageRatio * 100),
      ageDays,
      fetchedAt: source?.fetchedAt,
      fallbackReason,
      okCount: source?.okCount,
      total: source?.total,
      fallbackCount: source?.fallbackCount,
    }
  })

  const coverageScore = providers.length
    ? Math.round(
        (providers.reduce((sum, provider) => sum + provider.coverageRatio, 0) / providers.length) *
          100,
      )
    : 100
  const failedRequired = providers.filter((provider) => provider.required && !provider.ok)
  const staleProviders = providers.filter(
    (provider) => provider.ageDays !== null && provider.ageDays > STALE_SNAPSHOT_DAYS,
  )

  return {
    providers,
    coverageScore,
    failedRequiredCount: failedRequired.length,
    staleProviderCount: staleProviders.length,
    snapshotAgeDays,
    quoteAgeDays,
    navAgeDays,
    stalenessBadge:
      failedRequired.length > 0
        ? '核心降级'
        : staleProviders.length > 0 || (snapshotAgeDays ?? 0) > STALE_SNAPSHOT_DAYS
          ? '过旧'
          : providers.some((provider) => provider.fallback)
            ? '缓存兜底'
            : '新鲜',
  }
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
  const providerRegistry = buildProviderFreshnessRegistry({
    sourceHealth,
    quoteTradeDate,
    navDate,
    snapshotGeneratedAt,
    now,
  })
  const snapshotAgeDays = providerRegistry.snapshotAgeDays
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
  } else if ((snapshotAgeDays ?? 0) > STALE_SNAPSHOT_DAYS) {
    tone = 'warning'
    status = 'stale_snapshot'
    summary = `快照超过 ${snapshotAgeDays} 天`
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
  if ((snapshotAgeDays ?? 0) > STALE_SNAPSHOT_DAYS) {
    details.push(`快照距今天 ${snapshotAgeDays} 天`)
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
    coverageScore: providerRegistry.coverageScore,
    providerRegistry,
    snapshotAgeDays,
    stalenessBadge: providerRegistry.stalenessBadge,
    details,
  }
}
