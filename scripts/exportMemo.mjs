#!/usr/bin/env node
import { open, readFile, realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSignalEngine,
  buildStrategyOptimizer,
  buildTradingQualityProfile,
  buildTrendProfile,
  calculateDailyChange,
  calculatePremium,
  composePrimaryDecision,
  composeResearchMemo,
} from '../src/analysis/metrics.js'
import { normalizeHistoryArchive } from '../src/analysis/historyArchive.js'
import { formatMemoMarkdown, formatMemoText } from '../src/analysis/memoFormatter.js'

const SUPPORTED_FORMATS = new Set(['markdown', 'json', 'text'])
const LIVE_SNAPSHOT_URL = new URL('../src/data/liveSnapshot.json', import.meta.url)
const HISTORY_ARCHIVE_URL = new URL('../src/data/history/512400-snapshots.json', import.meta.url)
const PROTECTED_OUTPUT_PATHS = new Set([
  resolve(fileURLToPath(LIVE_SNAPSHOT_URL)),
  resolve(fileURLToPath(HISTORY_ARCHIVE_URL)),
])

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) return { error: `Missing value for ${optionName}.` }
  return { value, nextIndex: index + 1 }
}

function normalizeAsOfValue(value) {
  const normalizedValue = String(value ?? '').trim()
  if (!normalizedValue) return { error: 'Missing value for --as-of.' }
  return { value: normalizedValue }
}

function parseArgs(argv) {
  let format = 'markdown'
  let outputPath = null
  let asOf = null
  let sawFormat = false
  let sawOutput = false
  let sawAsOf = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--format') {
      if (sawFormat) return { error: 'Specify --format only once.' }
      sawFormat = true
      const { error, value, nextIndex } = readOptionValue(argv, i, '--format')
      if (error) return { error }
      format = value
      i = nextIndex
    } else if (arg.startsWith('--format=')) {
      if (sawFormat) return { error: 'Specify --format only once.' }
      sawFormat = true
      format = arg.slice('--format='.length)
    } else if (arg === '--output') {
      if (sawOutput) return { error: 'Specify --output only once.' }
      sawOutput = true
      const { error, value, nextIndex } = readOptionValue(argv, i, '--output')
      if (error) return { error }
      outputPath = value
      i = nextIndex
    } else if (arg.startsWith('--output=')) {
      if (sawOutput) return { error: 'Specify --output only once.' }
      sawOutput = true
      outputPath = arg.slice('--output='.length)
      if (!outputPath) return { error: 'Missing value for --output.' }
    } else if (arg === '--as-of') {
      if (sawAsOf) return { error: 'Specify --as-of only once.' }
      sawAsOf = true
      const { error, value, nextIndex } = readOptionValue(argv, i, '--as-of')
      if (error) return { error }
      const asOfValue = normalizeAsOfValue(value)
      if (asOfValue.error) return { error: asOfValue.error }
      asOf = asOfValue.value
      i = nextIndex
    } else if (arg.startsWith('--as-of=')) {
      if (sawAsOf) return { error: 'Specify --as-of only once.' }
      sawAsOf = true
      const asOfValue = normalizeAsOfValue(arg.slice('--as-of='.length))
      if (asOfValue.error) return { error: asOfValue.error }
      asOf = asOfValue.value
    } else {
      return { error: `Unknown argument: ${arg}` }
    }
  }

  return { format, outputPath, asOf }
}

async function statsMatchProtectedDataFile(outputStats) {
  for (const protectedPath of PROTECTED_OUTPUT_PATHS) {
    const protectedStats = await stat(protectedPath)
    if (outputStats.dev === protectedStats.dev && outputStats.ino === protectedStats.ino) {
      return true
    }
  }
  return false
}

async function outputTargetsProtectedDataFile(resolvedPath) {
  if (PROTECTED_OUTPUT_PATHS.has(resolvedPath)) return true

  let outputStats
  try {
    outputStats = await stat(resolvedPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }

  const canonicalOutputPath = await realpath(resolvedPath)
  if (PROTECTED_OUTPUT_PATHS.has(canonicalOutputPath)) return true

  return statsMatchProtectedDataFile(outputStats)
}

async function resolveOutputPath(outputPath) {
  if (!outputPath) return null

  const resolvedPath = resolve(process.cwd(), outputPath)
  try {
    if (await outputTargetsProtectedDataFile(resolvedPath)) {
      return {
        error: `Refusing to write memo output over protected data file: ${outputPath}`,
      }
    }
  } catch (error) {
    return { error: `Unable to inspect memo output path: ${outputPath}` }
  }
  return { path: resolvedPath }
}

async function writeMemoOutput(outputPath, renderedMemo) {
  let fileHandle
  let existingFile = true
  try {
    try {
      fileHandle = await open(outputPath, 'r+')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      existingFile = false
      fileHandle = await open(outputPath, 'wx')
    }

    const outputStats = await fileHandle.stat()
    if (existingFile && await statsMatchProtectedDataFile(outputStats)) {
      const error = new Error('protected data file')
      error.code = 'PROTECTED_OUTPUT'
      throw error
    }

    if (existingFile) await fileHandle.truncate(0)
    await fileHandle.writeFile(renderedMemo, 'utf8')
  } finally {
    await fileHandle?.close()
  }
}

function buildFactorBaskets() {
  return [
    { name: '黄金链', weight: 19.54, trend: 25, risk: 95 },
    { name: '铜钼链', weight: 16.24, trend: 59, risk: 33 },
    { name: '稀土链', weight: 5.48, trend: 71, risk: 61 },
    { name: '铝链', weight: 7.03, trend: 48, risk: 95 },
    { name: '锂钴链', weight: 8.07, trend: 100, risk: 95 },
  ]
}

function calendarDate(value) {
  const text = String(value ?? '').trim()
  const datePrefix = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (datePrefix) return datePrefix[1]

  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString().slice(0, 10)
}

function finiteMetric(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function boundedPercent(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function historyTrendState(signal) {
  if (signal.avgTrend >= 70) return '驱动共振'
  if (signal.avgTrend >= 50) return '震荡观察'
  return '驱动偏弱'
}

function historyRiskAction(risk) {
  if (risk.tone === 'danger') return '历史风险偏高'
  if (risk.tone === 'warning') return '历史风险观察'
  return '历史风险可控'
}

function matchesAsOf(snapshot, asOf) {
  const asOfText = String(asOf ?? '').trim()
  const asOfDate = calendarDate(asOfText)
  return (
    snapshot.generatedAt === asOfText ||
    (asOfDate !== null && (snapshot.date === asOfDate || calendarDate(snapshot.generatedAt) === asOfDate))
  )
}

async function loadArchivedSnapshot(asOf) {
  const archive = JSON.parse(await readFile(HISTORY_ARCHIVE_URL, 'utf8'))
  const snapshots = normalizeHistoryArchive(archive)
  const snapshot = snapshots.find((entry) => matchesAsOf(entry, asOf))

  if (!snapshot) {
    const error = new Error(`No archived snapshot found for --as-of=${asOf}.`)
    error.code = 'AS_OF_NOT_FOUND'
    throw error
  }

  return snapshot
}

function buildArchivedMemo(snapshot) {
  const premium = finiteMetric(snapshot.premium)
  const dailyChange = finiteMetric(snapshot.quote.changePercent)
  const signalScore = boundedPercent(snapshot.signal.avgTrend)
  const confidence = boundedPercent(100 - snapshot.signal.avgRisk)
  const riskSummary = snapshot.risk.topDriver
    ? `${snapshot.risk.summary}，最高风险 ${snapshot.risk.topDriver.key} ${snapshot.risk.topDriver.riskScore}`
    : snapshot.risk.summary

  return composeResearchMemo({
    primaryDecision: {
      action: snapshot.decision.action,
      exposure: snapshot.exposure,
      score: signalScore,
      source: `历史归档 ${snapshot.date}`,
      rule: `historyArchive ${snapshot.date}`,
      tone: snapshot.decision.tone,
    },
    signal: {
      action: snapshot.decision.action,
      score: signalScore,
      confidence,
      reasons: [
        `归档行情：价格 ${snapshot.quote.price ?? '暂无'}，净值 ${snapshot.quote.nav ?? '暂无'}`,
        `归档信号：${snapshot.signal.positiveCount}/${snapshot.signal.driverCount} 个驱动向上，均值 ${snapshot.signal.avgTrend}`,
        `归档风险：${riskSummary}`,
      ],
      invalidationRules: [
        '归档快照不代表实时行情，重新导出 live memo 后再执行交易',
        '高风险驱动达到3个及以上时，维持风险降档或禁止追价',
      ],
    },
    tradingQuality: {
      action: historyRiskAction(snapshot.risk),
      score: confidence,
      watchPoints: [
        `成交额 ${snapshot.quote.amountCny ?? '暂无'}，换手率 ${snapshot.quote.turnoverRate ?? '暂无'}`,
      ],
    },
    trendProfile: {
      state: historyTrendState(snapshot.signal),
    },
    premium,
    dailyChange,
  })
}

async function buildLiveMemo() {
  const snapshot = JSON.parse(await readFile(LIVE_SNAPSHOT_URL, 'utf8'))
  const factorBaskets = buildFactorBaskets()
  const trendProfile = buildTrendProfile(snapshot.etfKlines)
  const premium = calculatePremium(snapshot.quote.price, snapshot.nav.unit)
  const dailyChange = calculateDailyChange(snapshot.quote.price, snapshot.quote.previousClose)
  const signal = buildSignalEngine({
    premium,
    dailyChange,
    riskBudget: 48,
    factorBaskets,
    trendProfile,
    quote: snapshot.quote,
  })
  const optimizer = buildStrategyOptimizer({
    klines: snapshot.etfKlines,
    factorBaskets,
  })
  const tradingQuality = buildTradingQualityProfile({
    etfKlines: snapshot.etfKlines,
    benchmarkKlines: snapshot.benchmarkKlines,
    navSeries: snapshot.navTrend,
    price: snapshot.quote.price,
    nav: snapshot.nav.unit,
    quote: snapshot.quote,
  })
  const primaryDecision = composePrimaryDecision({
    signal,
    optimizer,
    riskBudget: 48,
    trendProfile,
  })
  return composeResearchMemo({
    primaryDecision,
    signal,
    tradingQuality,
    trendProfile,
    premium,
    dailyChange,
  })
}

async function buildMemo({ asOf } = {}) {
  if (asOf) return buildArchivedMemo(await loadArchivedSnapshot(asOf))
  return buildLiveMemo()
}

function renderMemo(memo, format) {
  if (format === 'json') return JSON.stringify(memo, null, 2)
  if (format === 'text') return formatMemoText(memo)
  return formatMemoMarkdown(memo)
}

const { error, format, outputPath, asOf } = parseArgs(process.argv.slice(2))
if (error) {
  console.error(error)
  process.exit(1)
}

if (!SUPPORTED_FORMATS.has(format)) {
  console.error(`Unsupported format: ${format || '(missing)'}. Use markdown, json, or text.`)
  process.exit(1)
}

const output = await resolveOutputPath(outputPath)
if (output?.error) {
  console.error(output.error)
  process.exit(1)
}

let memo
try {
  memo = await buildMemo({ asOf })
} catch (error) {
  if (error?.code === 'AS_OF_NOT_FOUND') {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}
const renderedMemo = `${renderMemo(memo, format)}\n`
if (output?.path) {
  try {
    await writeMemoOutput(output.path, renderedMemo)
  } catch (error) {
    const message = error?.code === 'PROTECTED_OUTPUT'
      ? `Refusing to write memo output over protected data file: ${outputPath}`
      : `Unable to write memo output: ${outputPath}`
    console.error(message)
    process.exit(1)
  }
} else {
  process.stdout.write(renderedMemo)
}
