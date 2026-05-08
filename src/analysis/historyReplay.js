// 把 normalizeHistoryArchive 输出的归档帧组装成回放面板用的视图模型：
// 升序帧、当前帧定位（默认最新或按 asOf 匹配）、趋势/风险均值、首尾差与峰谷帧。
// 仅消费已归一化的快照对象，纯函数读路径，不写源数据。

function emptySummary() {
  return {
    frameCount: 0,
    firstDate: null,
    lastDate: null,
    avgTrend: null,
    avgRisk: null,
    trendDelta: null,
    trendDirection: 'none',
    peakTrend: null,
    troughTrend: null,
  }
}

function emptySelection() {
  return {
    requestedAsOf: null,
    matchedDate: null,
    fallbackReason: 'no-frames',
    availableDates: [],
  }
}

function emptyReplay() {
  return {
    frames: [],
    currentIndex: null,
    currentFrame: null,
    summary: emptySummary(),
    selection: emptySelection(),
  }
}

function isFrameLike(entry) {
  return (
    Boolean(entry) &&
    typeof entry === 'object' &&
    typeof entry.date === 'string' &&
    entry.date.length > 0 &&
    Number.isFinite(entry.signal?.avgTrend) &&
    Number.isFinite(entry.signal?.avgRisk)
  )
}

function normalizeAsOf(asOf) {
  if (typeof asOf !== 'string') return ''
  return asOf.trim()
}

function matchesAsOf(frame, asOf) {
  if (frame.date === asOf) return true
  if (frame.generatedAt === asOf) return true
  if (typeof frame.generatedAt === 'string' && frame.generatedAt.slice(0, 10) === asOf) return true
  return false
}

function roundTo(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function buildSummary(frames) {
  if (frames.length === 0) return emptySummary()

  const trendValues = frames.map((frame) => frame.signal.avgTrend)
  const riskValues = frames.map((frame) => frame.signal.avgRisk)

  let peakIdx = 0
  let troughIdx = 0
  for (let i = 1; i < frames.length; i += 1) {
    if (trendValues[i] > trendValues[peakIdx]) peakIdx = i
    if (trendValues[i] < trendValues[troughIdx]) troughIdx = i
  }

  const first = frames[0]
  const last = frames[frames.length - 1]
  const trendDelta = roundTo(last.signal.avgTrend - first.signal.avgTrend, 1)
  let trendDirection = 'flat'
  if (trendDelta > 0) trendDirection = 'up'
  else if (trendDelta < 0) trendDirection = 'down'

  const trendSum = trendValues.reduce((sum, value) => sum + value, 0)
  const riskSum = riskValues.reduce((sum, value) => sum + value, 0)

  return {
    frameCount: frames.length,
    firstDate: first.date,
    lastDate: last.date,
    avgTrend: roundTo(trendSum / frames.length, 1),
    avgRisk: roundTo(riskSum / frames.length, 1),
    trendDelta,
    trendDirection,
    peakTrend: { date: frames[peakIdx].date, avgTrend: trendValues[peakIdx] },
    troughTrend: { date: frames[troughIdx].date, avgTrend: trendValues[troughIdx] },
  }
}

export function buildHistoryReplay(snapshots, options = {}) {
  if (!Array.isArray(snapshots)) return emptyReplay()

  const valid = snapshots.filter(isFrameLike)
  if (valid.length === 0) return emptyReplay()

  const sorted = [...valid].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const frames = sorted.map((entry, index) => ({ ...entry, index }))

  const asOfProvided = Object.prototype.hasOwnProperty.call(options, 'asOf')
  const asOfQuery = normalizeAsOf(options.asOf)
  const availableDates = frames.map((frame) => frame.date)
  let currentIndex
  let currentFrame
  let fallbackReason
  let requestedAsOf
  if (asOfQuery) {
    const matchIndex = frames.findIndex((frame) => matchesAsOf(frame, asOfQuery))
    currentIndex = matchIndex === -1 ? null : matchIndex
    currentFrame = matchIndex === -1 ? null : frames[matchIndex]
    fallbackReason = matchIndex === -1 ? 'no-match' : null
    requestedAsOf = asOfQuery
  } else {
    currentIndex = frames.length - 1
    currentFrame = frames[currentIndex]
    fallbackReason = asOfProvided ? 'invalid-as-of' : 'no-as-of'
    requestedAsOf = null
  }

  return {
    frames,
    currentIndex,
    currentFrame,
    summary: buildSummary(frames),
    selection: {
      requestedAsOf,
      matchedDate: currentFrame ? currentFrame.date : null,
      fallbackReason,
      availableDates,
    },
  }
}
