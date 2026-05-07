#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
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

function parseFormat(argv) {
  const formatArg = argv.find((arg) => arg === '--format' || arg.startsWith('--format='))
  if (!formatArg) return 'markdown'
  if (formatArg === '--format') {
    const index = argv.indexOf(formatArg)
    return argv[index + 1] ?? ''
  }
  return formatArg.slice('--format='.length)
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

const format = parseFormat(process.argv.slice(2))
if (!SUPPORTED_FORMATS.has(format)) {
  console.error(`Unsupported format: ${format || '(missing)'}. Use markdown, json, or text.`)
  process.exit(1)
}

const memo = await buildMemo()
if (format === 'json') {
  console.log(JSON.stringify(memo, null, 2))
} else if (format === 'text') {
  console.log(formatMemoText(memo))
} else {
  console.log(formatMemoMarkdown(memo))
}
