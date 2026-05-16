#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDataFreshness, describeMarketStatus } from '../src/analysis/snapshotHealth.js'

const SUPPORTED_FORMATS = new Set(['text', 'json', 'markdown'])
const DEFAULT_SNAPSHOT_URL = new URL('../src/data/liveSnapshot.json', import.meta.url)

const ANSI = {
  reset: '[0m',
  bold: '[1m',
  dim: '[2m',
  green: '[32m',
  yellow: '[33m',
  red: '[31m',
  grey: '[90m',
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) return { error: `Missing value for ${optionName}.` }
  return { value, nextIndex: index + 1 }
}

export function parseArgs(argv) {
  let format = 'text'
  let snapshotPath = null
  let quiet = false
  let sawFormat = false
  let sawSnapshot = false

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
    } else if (arg === '--snapshot') {
      if (sawSnapshot) return { error: 'Specify --snapshot only once.' }
      sawSnapshot = true
      const { error, value, nextIndex } = readOptionValue(argv, i, '--snapshot')
      if (error) return { error }
      snapshotPath = value
      i = nextIndex
    } else if (arg.startsWith('--snapshot=')) {
      if (sawSnapshot) return { error: 'Specify --snapshot only once.' }
      sawSnapshot = true
      snapshotPath = arg.slice('--snapshot='.length)
      if (!snapshotPath) return { error: 'Missing value for --snapshot.' }
    } else if (arg === '--quiet') {
      quiet = true
    } else {
      return { error: `Unknown argument: ${arg}` }
    }
  }

  return { format, snapshotPath, quiet }
}

// Classify a provider into one of: fresh / recent / stale / missing.
// fresh = green, recent = yellow, stale = red, missing = grey.
export function classifyProvider(provider) {
  if (!provider.ok && !provider.fallback) return 'missing'
  if (provider.ageDays !== null && provider.ageDays !== undefined && provider.ageDays > 3) {
    return 'stale'
  }
  if (provider.fallback) return 'recent'
  return 'fresh'
}

function colorFor(classification) {
  switch (classification) {
    case 'fresh':
      return ANSI.green
    case 'recent':
      return ANSI.yellow
    case 'stale':
      return ANSI.red
    case 'missing':
      return ANSI.grey
    default:
      return ANSI.reset
  }
}

function ageLabel(provider) {
  if (provider.ageText) return provider.ageText
  if (provider.ageDays === null || provider.ageDays === undefined) return '新鲜度未知'
  return `滞后 ${provider.ageDays} 天`
}

// Build the rows the CLI surfaces. Each row is the {provider, status, lastUpdate, recommendation}
// shape requested by the task spec.
export function buildHealthRows(freshness) {
  const providers = freshness?.providerRegistry?.providers ?? []
  return providers.map((provider) => ({
    id: provider.id,
    provider: provider.label,
    role: provider.roleLabel,
    classification: classifyProvider(provider),
    status: provider.statusText,
    badge: provider.badge,
    lastUpdate: ageLabel(provider),
    fetchedAt: provider.fetchedAt ?? null,
    coveragePercent: provider.coveragePercent,
    recommendation: provider.nextAction,
  }))
}

// Map the row set to an exit code:
//  - 2 = any row is "missing" (failed source without fallback)
//  - 1 = any row is "stale"
//  - 0 = otherwise
export function computeExitCode(rows) {
  if (rows.some((row) => row.classification === 'missing')) return 2
  if (rows.some((row) => row.classification === 'stale')) return 1
  return 0
}

function padCell(value, width) {
  // Width is measured in display columns; handle CJK by counting wide chars as 2.
  const str = String(value ?? '')
  const visualWidth = displayWidth(str)
  if (visualWidth >= width) return str
  return str + ' '.repeat(width - visualWidth)
}

function displayWidth(str) {
  let width = 0
  for (const ch of str) {
    const code = ch.codePointAt(0)
    // Rough wide-char detection: CJK ideographs, Hangul, fullwidth forms, etc.
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xa000 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

function renderText(freshness, rows, marketStatus) {
  const header = [
    `${ANSI.bold}ETF 512400 数据源健康${ANSI.reset}`,
    `总览：${freshness.summary}（覆盖率 ${freshness.coverageScore}%）`,
    `行情：${marketStatus}`,
  ].join('\n')

  const columns = ['provider', 'role', 'status', 'lastUpdate', 'recommendation']
  const widths = {
    provider: Math.max(8, ...rows.map((row) => displayWidth(row.provider))),
    role: Math.max(4, ...rows.map((row) => displayWidth(row.role))),
    status: Math.max(6, ...rows.map((row) => displayWidth(row.status))),
    lastUpdate: Math.max(10, ...rows.map((row) => displayWidth(row.lastUpdate))),
    recommendation: Math.max(12, ...rows.map((row) => displayWidth(row.recommendation))),
  }

  const headerLabels = {
    provider: '数据源',
    role: '角色',
    status: '状态',
    lastUpdate: '新鲜度',
    recommendation: '建议',
  }
  const headerRow = columns.map((col) => padCell(headerLabels[col], widths[col])).join('  ')
  const separator = columns.map((col) => '-'.repeat(widths[col])).join('  ')

  const bodyRows = rows.map((row) => {
    const color = colorFor(row.classification)
    const cells = columns.map((col) => padCell(row[col], widths[col])).join('  ')
    return `${color}${cells}${ANSI.reset}`
  })

  return [header, '', headerRow, separator, ...bodyRows].join('\n')
}

function renderJson(freshness, rows, marketStatus) {
  return JSON.stringify(
    {
      status: freshness.status,
      tone: freshness.tone,
      summary: freshness.summary,
      coverageScore: freshness.coverageScore,
      stalenessBadge: freshness.stalenessBadge,
      snapshotAgeDays: freshness.snapshotAgeDays,
      quoteAgeDays: freshness.quoteAgeDays,
      navAgeDays: freshness.navAgeDays,
      marketStatus,
      providers: rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        role: row.role,
        classification: row.classification,
        status: row.status,
        badge: row.badge,
        lastUpdate: row.lastUpdate,
        fetchedAt: row.fetchedAt,
        coveragePercent: row.coveragePercent,
        recommendation: row.recommendation,
      })),
    },
    null,
    2,
  )
}

function escapePipe(value) {
  return String(value ?? '').replace(/\|/g, '\\|')
}

function renderMarkdown(freshness, rows, marketStatus) {
  const headerLines = [
    `# ETF 512400 数据源健康`,
    '',
    `- 总览：${freshness.summary}`,
    `- 覆盖率：${freshness.coverageScore}%`,
    `- 行情：${marketStatus}`,
    `- 标签：${freshness.stalenessBadge}`,
    '',
  ]
  const tableHeader = '| 数据源 | 角色 | 状态 | 新鲜度 | 建议 |'
  const tableDivider = '| --- | --- | --- | --- | --- |'
  const tableRows = rows.map(
    (row) =>
      `| ${escapePipe(row.provider)} | ${escapePipe(row.role)} | ${escapePipe(row.status)} | ${escapePipe(row.lastUpdate)} | ${escapePipe(row.recommendation)} |`,
  )

  return [...headerLines, tableHeader, tableDivider, ...tableRows].join('\n')
}

export function renderHealth(freshness, rows, marketStatus, format) {
  if (format === 'json') return renderJson(freshness, rows, marketStatus)
  if (format === 'markdown') return renderMarkdown(freshness, rows, marketStatus)
  return renderText(freshness, rows, marketStatus)
}

async function loadSnapshot(snapshotPath) {
  const targetUrl = snapshotPath
    ? new URL(`file://${resolve(process.cwd(), snapshotPath)}`)
    : DEFAULT_SNAPSHOT_URL
  let raw
  try {
    raw = await readFile(targetUrl, 'utf8')
  } catch (error) {
    const reason = error?.code === 'ENOENT' ? '快照文件不存在' : '快照文件不可读'
    const err = new Error(`${reason}: ${snapshotPath ?? fileURLToPath(DEFAULT_SNAPSHOT_URL)}`)
    err.code = 'SNAPSHOT_UNREADABLE'
    throw err
  }
  try {
    return JSON.parse(raw)
  } catch {
    const err = new Error(`快照不是合法 JSON: ${snapshotPath ?? fileURLToPath(DEFAULT_SNAPSHOT_URL)}`)
    err.code = 'SNAPSHOT_INVALID'
    throw err
  }
}

// Pure adapter the tests can call directly without spawning a child process.
// Accepts an in-memory snapshot object plus a `now` clock override for determinism.
export function runHealthCheck(snapshot, { now = new Date() } = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { error: '快照内容不合法', exitCode: 2 }
  }
  const sourceHealth = snapshot?.meta?.sourceHealth ?? []
  const snapshotGeneratedAt = snapshot?.meta?.generatedAt
  const quoteTradeDate = snapshot?.quote?.tradeDate
  const navDate = snapshot?.nav?.date
  const statusCode = snapshot?.quote?.statusCode

  const freshness = buildDataFreshness({
    snapshotGeneratedAt,
    quoteTradeDate,
    navDate,
    sourceHealth,
    now,
  })
  const marketStatus = describeMarketStatus({ quoteTradeDate, statusCode, now })
  const rows = buildHealthRows(freshness)
  const exitCode = computeExitCode(rows)
  return { freshness, marketStatus, rows, exitCode }
}

async function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.error) {
    console.error(parsed.error)
    return 1
  }
  if (!SUPPORTED_FORMATS.has(parsed.format)) {
    console.error(`Unsupported format: ${parsed.format || '(missing)'}. Use text, json, or markdown.`)
    return 1
  }

  let snapshot
  try {
    snapshot = await loadSnapshot(parsed.snapshotPath)
  } catch (error) {
    if (error?.code === 'SNAPSHOT_UNREADABLE' || error?.code === 'SNAPSHOT_INVALID') {
      console.error(error.message)
      return 2
    }
    console.error('Unable to load snapshot')
    return 2
  }

  const result = runHealthCheck(snapshot)
  if (result.error) {
    console.error(result.error)
    return result.exitCode ?? 2
  }

  const rendered = renderHealth(result.freshness, result.rows, result.marketStatus, parsed.format)

  if (parsed.quiet) {
    if (result.exitCode !== 0) {
      process.stdout.write(`${rendered}\n`)
    }
  } else {
    process.stdout.write(`${rendered}\n`)
  }

  return result.exitCode
}

// Only run the CLI when this script is executed directly, not when imported by tests.
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  const exitCode = await main(process.argv.slice(2))
  process.exit(exitCode)
}
