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

function providerRoleFor(source) {
  return source?.required ? 'core' : 'auxiliary'
}

function providerRoleLabel(role) {
  return role === 'core' ? '核心源' : '辅助源'
}

function ageTextFor(ageDays) {
  if (ageDays === null) return '新鲜度未知'
  if (ageDays <= 0) return '今日数据'
  if (ageDays === 1) return '上一交易日'
  return `滞后 ${ageDays} 天`
}

function providerStatusTextFor(status, ageDays) {
  if (status === 'failed') return '失败无缓存'
  if (status === 'fallback') return '缓存兜底'
  if (ageDays !== null && ageDays > STALE_SNAPSHOT_DAYS) return '源数据过旧'
  if (status === 'runtime') return '运行时实时'
  return '快照可用'
}

function providerNextActionFor({ status, ageDays, required, coverageRatio, fallback }) {
  if (status === 'failed' && required) return '先恢复核心源，仓位建议按降级口径执行'
  if (status === 'failed') return '补采辅助源；当前信号暂不依赖该源放大仓位'
  if (fallback && required) return '核心源仍在用缓存，刷新成功前不要上调仓位'
  if (fallback) return '缓存只作旁证，等待下一轮刷新复核'
  if (ageDays !== null && ageDays > STALE_SNAPSHOT_DAYS) return '重新刷新该源后再确认仓位'
  if (coverageRatio < 0.8) return '样本覆盖不足，先补齐缺口再提高权重'
  if (coverageRatio < 1) return '存在少量缺口，继续观察下一轮刷新'
  return '可纳入当前信号解释'
}

function providerSummaryLabel(providers, predicate) {
  const labels = providers.filter(predicate).map((provider) => provider.label)
  return labels.length ? labels.join('、') : '无'
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
    const role = providerRoleFor(source)
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
      statusText: providerStatusTextFor(status, ageDays),
      role,
      roleLabel: providerRoleLabel(role),
      ok: source?.ok !== false,
      fallback: Boolean(source?.fallback),
      runtime: Boolean(source?.runtime),
      coverageRatio,
      coveragePercent: Math.round(coverageRatio * 100),
      ageDays,
      ageText: ageTextFor(ageDays),
      fetchedAt: source?.fetchedAt,
      fallbackReason,
      nextAction: providerNextActionFor({
        status,
        ageDays,
        required: Boolean(source?.required),
        coverageRatio,
        fallback: Boolean(source?.fallback),
      }),
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
  const cacheProviders = providers.filter((provider) => provider.fallback)
  const failedProviders = providers.filter((provider) => !provider.ok && !provider.fallback)
  const coreProviders = providers.filter((provider) => provider.role === 'core')
  const auxiliaryProviders = providers.filter((provider) => provider.role === 'auxiliary')
  const actionItems = [
    ...new Set(
      providers
        .filter(
          (provider) =>
            !provider.ok ||
            provider.fallback ||
            (provider.ageDays !== null && provider.ageDays > STALE_SNAPSHOT_DAYS) ||
            provider.coverageRatio < 1,
        )
        .map((provider) => provider.nextAction),
    ),
  ].slice(0, 3)

  return {
    providers,
    coverageScore,
    failedRequiredCount: failedRequired.length,
    staleProviderCount: staleProviders.length,
    cacheProviderCount: cacheProviders.length,
    failedProviderCount: failedProviders.length,
    snapshotAgeDays,
    quoteAgeDays,
    navAgeDays,
    groups: {
      core: {
        count: coreProviders.length,
        labels: providerSummaryLabel(providers, (provider) => provider.role === 'core'),
      },
      auxiliary: {
        count: auxiliaryProviders.length,
        labels: providerSummaryLabel(providers, (provider) => provider.role === 'auxiliary'),
      },
      cache: {
        count: cacheProviders.length,
        labels: providerSummaryLabel(providers, (provider) => provider.fallback),
      },
      failed: {
        count: failedProviders.length,
        labels: providerSummaryLabel(providers, (provider) => !provider.ok && !provider.fallback),
      },
      stale: {
        count: staleProviders.length,
        labels: providerSummaryLabel(
          providers,
          (provider) => provider.ageDays !== null && provider.ageDays > STALE_SNAPSHOT_DAYS,
        ),
      },
    },
    actionItems: actionItems.length ? actionItems : ['数据源可用于当前信号，继续按计划刷新'],
    summary: `核心源 ${coreProviders.length} 个，辅助源 ${auxiliaryProviders.length} 个，缓存 ${cacheProviders.length} 个，失败 ${failedProviders.length} 个`,
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
