const DAY_MS = 24 * 60 * 60 * 1000

export const FRESHNESS = Object.freeze({
  FRESH: 'fresh',
  RECENT: 'recent',
  STALE: 'stale',
  MISSING: 'missing',
})

export const DEFAULT_THRESHOLDS_MS = Object.freeze({
  fresh: DAY_MS,
  stale: 3 * DAY_MS,
})

const FRESHNESS_LABEL = {
  [FRESHNESS.FRESH]: '新鲜',
  [FRESHNESS.RECENT]: '近期',
  [FRESHNESS.STALE]: '过旧',
  [FRESHNESS.MISSING]: '缺失',
}

const SEVERITY = {
  [FRESHNESS.FRESH]: 0,
  [FRESHNESS.RECENT]: 1,
  [FRESHNESS.STALE]: 2,
}

function parseAsOf(raw) {
  if (raw == null || raw === '') return { ms: null, iso: null, invalid: false }
  if (raw instanceof Date) {
    const t = raw.getTime()
    return Number.isNaN(t) ? { ms: null, iso: null, invalid: true } : { ms: t, iso: new Date(t).toISOString(), invalid: false }
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { ms: raw, iso: new Date(raw).toISOString(), invalid: false }
      : { ms: null, iso: null, invalid: true }
  }
  if (typeof raw === 'string') {
    const t = Date.parse(raw)
    return Number.isNaN(t)
      ? { ms: null, iso: null, invalid: true }
      : { ms: t, iso: new Date(t).toISOString(), invalid: false }
  }
  return { ms: null, iso: null, invalid: true }
}

function classifyFreshness(ageMs, thresholds) {
  if (ageMs == null) return FRESHNESS.MISSING
  if (ageMs <= thresholds.fresh) return FRESHNESS.FRESH
  if (ageMs <= thresholds.stale) return FRESHNESS.RECENT
  return FRESHNESS.STALE
}

function resolveNow(rawNow) {
  if (rawNow instanceof Date) return rawNow
  if (rawNow != null) return new Date(rawNow)
  return new Date()
}

export function normalizeSourceEntry(raw = {}, options = {}) {
  const now = resolveNow(options.now)
  const thresholds = { ...DEFAULT_THRESHOLDS_MS, ...(options.thresholds ?? {}) }

  const id = typeof raw.id === 'string' && raw.id ? raw.id : null
  const label = typeof raw.label === 'string' && raw.label ? raw.label : null
  const sourceId = id ?? label ?? 'unknown'
  const finalLabel = label ?? id ?? 'unknown'

  const ok = raw.ok !== false
  const fallback = Boolean(raw.fallback)
  const required = Boolean(raw.required)

  let parsed
  if (raw.asOf != null && raw.asOf !== '') {
    parsed = parseAsOf(raw.asOf)
  } else if (raw.asOfDate) {
    parsed = parseAsOf(raw.asOfDate)
  } else {
    parsed = { ms: null, iso: null, invalid: false }
  }

  const ageMs = parsed.ms != null ? now.getTime() - parsed.ms : null
  const freshness = classifyFreshness(ageMs, thresholds)

  let status
  let reason
  if (fallback) {
    status = 'fallback'
    reason = 'fallback'
  } else if (!ok) {
    status = 'failed'
    reason = required ? 'required-failure' : 'source-error'
  } else {
    status = 'ok'
    if (freshness === FRESHNESS.MISSING) {
      reason = parsed.invalid ? 'invalid-timestamp' : 'missing-timestamp'
    } else if (freshness === FRESHNESS.STALE) {
      reason = 'stale-age'
    } else {
      reason = 'ok'
    }
  }

  return {
    sourceId,
    label: finalLabel,
    required,
    ok,
    fallback,
    asOf: parsed.iso,
    ageMs,
    freshness,
    freshnessLabel: FRESHNESS_LABEL[freshness],
    reason,
    status,
  }
}

export function summarizeSourceHealth(entries = [], options = {}) {
  const list = Array.isArray(entries) ? entries : []
  const normalized = list.map((entry) => normalizeSourceEntry(entry, options))

  const counts = { fresh: 0, recent: 0, stale: 0, missing: 0 }
  for (const entry of normalized) {
    counts[entry.freshness] += 1
  }

  if (normalized.length === 0) {
    return {
      entries: [],
      freshness: FRESHNESS.MISSING,
      counts,
      requiredMissing: [],
    }
  }

  let worst = FRESHNESS.FRESH
  for (const entry of normalized) {
    const effective = entry.freshness === FRESHNESS.MISSING ? FRESHNESS.STALE : entry.freshness
    if (SEVERITY[effective] > SEVERITY[worst]) worst = effective
  }

  const requiredMissing = normalized.filter(
    (entry) => entry.required && !entry.ok && !entry.fallback,
  )

  return {
    entries: normalized,
    freshness: worst,
    counts,
    requiredMissing,
  }
}
