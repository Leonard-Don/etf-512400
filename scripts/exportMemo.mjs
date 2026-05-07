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
import { formatMemoMarkdown, formatMemoText } from '../src/analysis/memoFormatter.js'

const SUPPORTED_FORMATS = new Set(['markdown', 'json', 'text'])
const PROTECTED_OUTPUT_PATHS = new Set([
  resolve(fileURLToPath(new URL('../src/data/liveSnapshot.json', import.meta.url))),
  resolve(fileURLToPath(new URL('../src/data/history/512400-snapshots.json', import.meta.url))),
])

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) return { error: `Missing value for ${optionName}.` }
  return { value, nextIndex: index + 1 }
}

function parseArgs(argv) {
  let format = 'markdown'
  let outputPath = null
  let sawFormat = false
  let sawOutput = false

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
    } else {
      return { error: `Unknown argument: ${arg}` }
    }
  }

  return { format, outputPath }
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

async function buildMemo() {
  const snapshot = JSON.parse(await readFile(new URL('../src/data/liveSnapshot.json', import.meta.url), 'utf8'))
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

function renderMemo(memo, format) {
  if (format === 'json') return JSON.stringify(memo, null, 2)
  if (format === 'text') return formatMemoText(memo)
  return formatMemoMarkdown(memo)
}

const { error, format, outputPath } = parseArgs(process.argv.slice(2))
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

const memo = await buildMemo()
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
