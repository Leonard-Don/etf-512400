import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildHealthRows,
  classifyProvider,
  computeExitCode,
  parseArgs,
  renderHealth,
  runHealthCheck,
} from '../scripts/health.mjs'

const scriptUrl = new URL('../scripts/health.mjs', import.meta.url)
const scriptPath = fileURLToPath(scriptUrl)
const packageUrl = new URL('../package.json', import.meta.url)

// Anchor 'now' to a fixed Shanghai-time moment so freshness math is deterministic.
// Fixture 'fresh' snapshots use a generatedAt that is the same calendar day.
const NOW = new Date('2026-05-07T08:00:00Z')

function freshFixture() {
  return {
    meta: {
      generatedAt: '2026-05-07T03:00:00.000Z',
      mode: 'refreshed',
      sourceHealth: [
        {
          id: 'quote',
          label: 'ETF行情',
          required: true,
          ok: true,
          fallback: false,
          fetchedAt: '2026-05-07T03:00:00.000Z',
        },
        {
          id: 'etfKlines',
          label: '512400 日K',
          required: true,
          ok: true,
          fallback: false,
          fetchedAt: '2026-05-07T03:00:00.000Z',
        },
        {
          id: 'fundTrend',
          label: '基金净值趋势',
          required: true,
          ok: true,
          fallback: false,
          fetchedAt: '2026-05-07T03:00:00.000Z',
        },
      ],
    },
    quote: { tradeDate: '2026-05-07', statusCode: 5 },
    nav: { date: '2026-05-07' },
  }
}

function staleFixture() {
  return {
    meta: {
      generatedAt: '2026-05-01T03:00:00.000Z',
      mode: 'refreshed',
      sourceHealth: [
        {
          id: 'quote',
          label: 'ETF行情',
          required: true,
          ok: true,
          fallback: false,
          fetchedAt: '2026-05-01T03:00:00.000Z',
        },
        {
          id: 'fundTrend',
          label: '基金净值趋势',
          required: true,
          ok: true,
          fallback: false,
          fetchedAt: '2026-05-01T03:00:00.000Z',
        },
      ],
    },
    // Trade date is 6 days behind 'now' → triggers stale classification.
    quote: { tradeDate: '2026-05-01', statusCode: 5 },
    nav: { date: '2026-05-01' },
  }
}

function missingFixture() {
  return {
    meta: {
      generatedAt: '2026-05-07T03:00:00.000Z',
      mode: 'partial',
      sourceHealth: [
        {
          id: 'quote',
          label: 'ETF行情',
          required: true,
          ok: false,
          fallback: false,
          fetchedAt: '2026-05-07T03:00:00.000Z',
          error: 'fetch failed',
        },
        {
          id: 'fundTrend',
          label: '基金净值趋势',
          required: true,
          ok: true,
          fallback: false,
          fetchedAt: '2026-05-07T03:00:00.000Z',
        },
      ],
    },
    quote: { tradeDate: '2026-05-07', statusCode: 5 },
    nav: { date: '2026-05-07' },
  }
}

function fallbackFixture() {
  return {
    meta: {
      generatedAt: '2026-05-07T03:00:00.000Z',
      mode: 'partial',
      sourceHealth: [
        {
          id: 'quote',
          label: 'ETF行情',
          required: true,
          ok: true,
          fallback: false,
          fetchedAt: '2026-05-07T03:00:00.000Z',
        },
        {
          id: 'fundGauge',
          label: '盘中估算净值',
          required: false,
          ok: false,
          fallback: true,
          fetchedAt: '2026-05-07T03:00:00.000Z',
          error: 'gauge failed',
        },
      ],
    },
    quote: { tradeDate: '2026-05-07', statusCode: 5 },
    nav: { date: '2026-05-07' },
  }
}

test('health CLI: package script 暴露 npm 入口', () => {
  const packageJson = JSON.parse(readFileSync(packageUrl, 'utf8'))
  assert.equal(packageJson.scripts?.health, 'node scripts/health.mjs')
})

test('health: parseArgs 默认 format=text 且无 snapshot/quiet', () => {
  assert.deepEqual(parseArgs([]), { format: 'text', snapshotPath: null, quiet: false })
})

test('health: parseArgs 接受 --format, --snapshot, --quiet 三种形态', () => {
  assert.deepEqual(parseArgs(['--format=json', '--snapshot=/tmp/x.json', '--quiet']), {
    format: 'json',
    snapshotPath: '/tmp/x.json',
    quiet: true,
  })
  assert.deepEqual(parseArgs(['--format', 'markdown', '--snapshot', '/tmp/y.json']), {
    format: 'markdown',
    snapshotPath: '/tmp/y.json',
    quiet: false,
  })
})

test('health: parseArgs 拒绝重复 --format/--snapshot 与未知参数', () => {
  assert.ok(parseArgs(['--format=text', '--format=json']).error)
  assert.ok(parseArgs(['--snapshot=a', '--snapshot=b']).error)
  assert.ok(parseArgs(['--unknown']).error)
})

test('health: classifyProvider 区分 fresh/recent/stale/missing', () => {
  assert.equal(classifyProvider({ ok: true, fallback: false, ageDays: 0 }), 'fresh')
  assert.equal(classifyProvider({ ok: false, fallback: true, ageDays: 0 }), 'recent')
  assert.equal(classifyProvider({ ok: true, fallback: false, ageDays: 9 }), 'stale')
  assert.equal(classifyProvider({ ok: false, fallback: false, ageDays: 0 }), 'missing')
})

test('health: runHealthCheck 全新鲜场景退出码 0', () => {
  const result = runHealthCheck(freshFixture(), { now: NOW })
  assert.equal(result.exitCode, 0)
  assert.equal(result.rows.every((row) => row.classification === 'fresh'), true)
})

test('health: runHealthCheck 过旧场景退出码 1', () => {
  const result = runHealthCheck(staleFixture(), { now: NOW })
  assert.equal(result.exitCode, 1)
  assert.ok(result.rows.some((row) => row.classification === 'stale'))
})

test('health: runHealthCheck 失败无缓存场景退出码 2', () => {
  const result = runHealthCheck(missingFixture(), { now: NOW })
  assert.equal(result.exitCode, 2)
  assert.ok(result.rows.some((row) => row.classification === 'missing'))
})

test('health: runHealthCheck 缓存兜底场景退出码 0 (recent 视为可接受)', () => {
  const result = runHealthCheck(fallbackFixture(), { now: NOW })
  assert.equal(result.exitCode, 0)
  assert.ok(result.rows.some((row) => row.classification === 'recent'))
})

test('health: runHealthCheck 非对象输入返回 exitCode=2', () => {
  assert.equal(runHealthCheck(null).exitCode, 2)
  assert.equal(runHealthCheck('not-a-snapshot').exitCode, 2)
})

test('health: computeExitCode 多 row 时取最严重等级', () => {
  assert.equal(
    computeExitCode([
      { classification: 'fresh' },
      { classification: 'stale' },
      { classification: 'missing' },
    ]),
    2,
  )
  assert.equal(
    computeExitCode([{ classification: 'fresh' }, { classification: 'stale' }]),
    1,
  )
  assert.equal(computeExitCode([{ classification: 'fresh' }]), 0)
})

test('health: renderHealth text 包含 ANSI 转义和列头', () => {
  const result = runHealthCheck(freshFixture(), { now: NOW })
  const out = renderHealth(result.freshness, result.rows, result.marketStatus, 'text')
  assert.ok(out.includes('['), 'text 输出必须包含 ANSI 转义')
  assert.ok(out.includes('数据源'), 'text 输出必须包含表头')
})

test('health: renderHealth json 是合法对象，含 providers 数组', () => {
  const result = runHealthCheck(freshFixture(), { now: NOW })
  const out = renderHealth(result.freshness, result.rows, result.marketStatus, 'json')
  const parsed = JSON.parse(out)
  assert.equal(typeof parsed.summary, 'string')
  assert.ok(Array.isArray(parsed.providers))
  assert.equal(parsed.providers.length, result.rows.length)
  for (const provider of parsed.providers) {
    assert.ok(['fresh', 'recent', 'stale', 'missing'].includes(provider.classification))
  }
})

test('health: renderHealth json 不含 ANSI 转义', () => {
  const result = runHealthCheck(staleFixture(), { now: NOW })
  const out = renderHealth(result.freshness, result.rows, result.marketStatus, 'json')
  assert.ok(!out.includes('['), 'json 输出不应包含 ANSI 转义')
})

test('health: renderHealth markdown 含表格分隔符与列头', () => {
  const result = runHealthCheck(freshFixture(), { now: NOW })
  const out = renderHealth(result.freshness, result.rows, result.marketStatus, 'markdown')
  assert.ok(out.includes('|'), 'markdown 输出必须包含表格分隔符')
  assert.ok(out.includes('---'), 'markdown 输出必须包含表格分隔行')
  assert.ok(out.includes('| 数据源 |'), 'markdown 输出必须包含表头列')
  assert.ok(!out.includes('['), 'markdown 输出不应包含 ANSI 转义')
})

test('health: buildHealthRows 暴露 {provider, status, lastUpdate, recommendation}', () => {
  const result = runHealthCheck(freshFixture(), { now: NOW })
  for (const row of result.rows) {
    assert.equal(typeof row.provider, 'string')
    assert.equal(typeof row.status, 'string')
    assert.equal(typeof row.lastUpdate, 'string')
    assert.equal(typeof row.recommendation, 'string')
    assert.ok(['fresh', 'recent', 'stale', 'missing'].includes(row.classification))
  }
})

// ---- Integration: actual CLI spawn for a representative path ----

test('health CLI: 默认 snapshot 路径运行成功（端到端冒烟）', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--format=json'], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  // 当前 fixture 快照可能因日期已过而 stale；只断言不是 missing(2) 且 stdout 是合法 JSON
  assert.notEqual(result.status, 2, `exit=2 表示快照不可读: ${result.stderr}`)
  const parsed = JSON.parse(result.stdout)
  assert.ok(Array.isArray(parsed.providers))
})

test('health CLI: --snapshot 缺失文件退出码 2 且 stderr 干净', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'etf-health-cli-'))
  const missingPath = join(outputDir, 'does-not-exist.json')
  try {
    const result = spawnSync(process.execPath, [scriptPath, `--snapshot=${missingPath}`], {
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /快照文件不存在/)
    assert.doesNotMatch(result.stderr, /Error:|at async|node:internal/i)
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

test('health CLI: --snapshot 非法 JSON 退出码 2', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'etf-health-cli-invalid-'))
  const path = join(outputDir, 'broken.json')
  writeFileSync(path, '{not json', 'utf8')
  try {
    const result = spawnSync(process.execPath, [scriptPath, `--snapshot=${path}`], {
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /合法 JSON/)
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

test('health CLI: --quiet 在全新鲜场景下抑制输出', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'etf-health-cli-quiet-'))
  const path = join(outputDir, 'snapshot.json')
  // Use a generatedAt close to "now" so the snapshot reads as fresh from the CLI's perspective.
  const nowIso = new Date().toISOString()
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const snapshot = {
    meta: {
      generatedAt: nowIso,
      mode: 'refreshed',
      sourceHealth: [
        {
          id: 'quote',
          label: 'ETF行情',
          required: true,
          ok: true,
          fallback: false,
          fetchedAt: nowIso,
        },
      ],
    },
    quote: { tradeDate: today, statusCode: 5 },
    nav: { date: today },
  }
  writeFileSync(path, JSON.stringify(snapshot), 'utf8')
  try {
    const result = spawnSync(
      process.execPath,
      [scriptPath, `--snapshot=${path}`, '--quiet'],
      { encoding: 'utf8', timeout: 10_000 },
    )
    assert.equal(result.status, 0)
    assert.equal(result.stdout, '', '--quiet 在全新鲜场景下应抑制输出')
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})
