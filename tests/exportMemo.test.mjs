import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeHistoryArchive } from '../src/analysis/historyArchive.js'
import { composeResearchMemo } from '../src/analysis/researchMemo.js'

const scriptUrl = new URL('../scripts/exportMemo.mjs', import.meta.url)
const scriptPath = fileURLToPath(scriptUrl)
const packageUrl = new URL('../package.json', import.meta.url)
const liveSnapshotUrl = new URL('../src/data/liveSnapshot.json', import.meta.url)
const historySnapshotsUrl = new URL('../src/data/history/512400-snapshots.json', import.meta.url)

function runExportMemo(args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
  })
}

test('exportMemo CLI: package script 暴露 npm 入口', () => {
  const packageJson = JSON.parse(readFileSync(packageUrl, 'utf8'))
  assert.equal(packageJson.scripts?.['memo:export'], 'node scripts/exportMemo.mjs')
})

test('exportMemo CLI: 默认输出 Markdown，含标题与四大区块', () => {
  const result = runExportMemo()
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`)
  const out = result.stdout
  assert.match(out, /^# ETF 512400 研究备忘/m)
  assert.match(out, /^### 解释链/m)
  assert.match(out, /^### 关键依据/m)
  assert.match(out, /^### 失效条件/m)
  assert.match(out, /^### 指标/m)
})

test('exportMemo CLI: --format=json 输出可解析的对象，含必要字段', () => {
  const result = runExportMemo(['--format=json'])
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`)
  const memo = JSON.parse(result.stdout)
  assert.ok(typeof memo.headline === 'string' && memo.headline.length > 0)
  assert.ok(Array.isArray(memo.drivers) && memo.drivers.length === 3)
  assert.ok(Array.isArray(memo.reasons))
  assert.ok(Array.isArray(memo.invalidations))
  assert.ok(memo.metrics && typeof memo.metrics === 'object')
  assert.ok(['positive', 'neutral', 'warning'].includes(memo.tone))
})

test('exportMemo CLI: --format=json 锁定顶层与 metrics 的 schema 形态', () => {
  const result = runExportMemo(['--format=json'])
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`)
  const memo = JSON.parse(result.stdout)

  assert.deepEqual(
    Object.keys(memo).sort(),
    ['drivers', 'headline', 'invalidations', 'metrics', 'reasons', 'rule', 'source', 'tone'],
    'memo 顶层键集合发生漂移',
  )

  assert.deepEqual(
    Object.keys(memo.metrics).sort(),
    ['confidence', 'dailyChange', 'exposure', 'premium', 'score'],
    'memo.metrics 键集合发生漂移',
  )
  for (const key of Object.keys(memo.metrics)) {
    assert.equal(typeof memo.metrics[key], 'number', `metrics.${key} 必须是 number`)
    assert.ok(Number.isFinite(memo.metrics[key]), `metrics.${key} 必须是有限数`)
  }

  assert.equal(typeof memo.source, 'string')
  assert.ok(memo.source.length > 0, 'memo.source 不能为空字符串')
  assert.equal(typeof memo.rule, 'string')
  assert.ok(memo.rule.length > 0, 'memo.rule 不能为空字符串')

  for (const driver of memo.drivers) {
    assert.equal(typeof driver, 'string', 'driver 必须是 string')
    assert.ok(driver.length > 0, 'driver 不能为空字符串')
  }
})

test('exportMemo CLI: --as-of 从匹配历史归档快照导出 JSON memo', () => {
  const archive = JSON.parse(readFileSync(historySnapshotsUrl, 'utf8'))
  const archivedSnapshot = normalizeHistoryArchive(archive)[0]
  assert.ok(archivedSnapshot, 'fixture archive should contain at least one normalized snapshot')

  const liveResult = runExportMemo(['--format=json'])
  assert.equal(liveResult.status, 0, `expected live export exit 0, got ${liveResult.status}\n${liveResult.stderr}`)
  const liveMemo = JSON.parse(liveResult.stdout)

  const result = runExportMemo(['--format=json', `--as-of=${archivedSnapshot.date}`])
  assert.equal(result.status, 0, `expected archived export exit 0, got ${result.status}\n${result.stderr}`)
  const memo = JSON.parse(result.stdout)

  assert.deepEqual(Object.keys(memo).sort(), Object.keys(liveMemo).sort())
  assert.deepEqual(Object.keys(memo.metrics).sort(), Object.keys(liveMemo.metrics).sort())
  assert.match(memo.source, new RegExp(archivedSnapshot.date))
  assert.equal(memo.headline, `${archivedSnapshot.decision.action}（仓位 ${Math.round(archivedSnapshot.exposure * 100)}%）`)
  assert.equal(memo.metrics.premium, archivedSnapshot.premium)
  assert.equal(memo.metrics.dailyChange, archivedSnapshot.quote.changePercent)
  assert.equal(memo.metrics.exposure, archivedSnapshot.exposure)
  assert.notEqual(
    memo.metrics.dailyChange,
    liveMemo.metrics.dailyChange,
    '--as-of must not use liveSnapshot previousClose-derived dailyChange',
  )

  const timestampResult = runExportMemo(['--format=json', `--as-of=${archivedSnapshot.generatedAt}`])
  assert.equal(
    timestampResult.status,
    0,
    `expected archived timestamp export exit 0, got ${timestampResult.status}\n${timestampResult.stderr}`,
  )
  assert.deepEqual(JSON.parse(timestampResult.stdout).metrics, memo.metrics)
})

test('exportMemo CLI: 重复或空白 --as-of 时安全拒绝且 stderr 干净', () => {
  const duplicateVariants = [
    ['--as-of', '/tmp/first-as-of', '--as-of', '/var/folders/second-as-of'],
    ['--as-of=/tmp/first-as-of', '--as-of', '/var/folders/second-as-of'],
  ]

  for (const args of duplicateVariants) {
    const label = args.join(' ')
    const result = runExportMemo(args)
    assert.notEqual(result.status, 0, `[${label}] duplicate --as-of should exit non-zero`)
    assert.equal(result.stdout, '', `[${label}] stdout 必须为空`)
    assert.match(result.stderr, /--as-of only once/i, `[${label}] stderr 应提示只传一次`)
    assert.doesNotMatch(
      result.stderr,
      /Error:|at async|node:internal|\/tmp\/|\/var\/folders/i,
      `[${label}] stderr 不应含 Node 堆栈或路径`,
    )
  }

  const blankResult = runExportMemo(['--as-of', '   '])
  assert.notEqual(blankResult.status, 0, 'blank --as-of should exit non-zero')
  assert.equal(blankResult.stdout, '', 'blank --as-of stdout 必须为空')
  assert.match(blankResult.stderr, /Missing value for --as-of/i)
  assert.doesNotMatch(
    blankResult.stderr,
    /No archived snapshot|Error:|at async|node:internal|\/tmp\/|\/var\/folders/i,
    'blank --as-of stderr 不应含归档查找失败、Node 堆栈或路径',
  )
})

test('exportMemo JSON pipeline: sparse-but-valid zero metrics remain numeric through serialization', () => {
  const memo = composeResearchMemo({
    primaryDecision: {
      action: '观察持有',
      exposure: 0,
      score: 0,
      source: 'fixture',
      rule: 'zero-metric-guard',
      tone: 'neutral',
    },
    signal: {
      action: '观望',
      score: 0,
      confidence: 0,
      reasons: ['信号为零但仍是有效数值'],
      invalidationRules: ['跌破均线'],
    },
    tradingQuality: {
      action: '平稳',
      score: 0,
      watchPoints: ['成交量观察'],
    },
    trendProfile: { state: '横盘' },
    premium: 0,
    dailyChange: 0,
  })

  const exportedMemo = JSON.parse(JSON.stringify(memo))
  assert.deepEqual(exportedMemo.metrics, {
    score: 0,
    exposure: 0,
    confidence: 0,
    premium: 0,
    dailyChange: 0,
  })
  for (const key of Object.keys(exportedMemo.metrics)) {
    assert.equal(typeof exportedMemo.metrics[key], 'number', `metrics.${key} 必须保持 number`)
  }
})

test('exportMemo CLI: --format=text 输出单行摘要', () => {
  const result = runExportMemo(['--format=text'])
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`)
  const out = result.stdout.trim()
  assert.equal(out.split('\n').length, 1, 'text format should be one line')
  assert.ok(out.length > 0)
})

test('exportMemo CLI: --output 写入与 stdout 一致，且不改动数据 JSON', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'etf-memo-export-'))
  const outputPath = join(outputDir, 'memo.json')
  const liveSnapshotBefore = readFileSync(liveSnapshotUrl, 'utf8')
  const historySnapshotsBefore = readFileSync(historySnapshotsUrl, 'utf8')

  try {
    const stdoutResult = runExportMemo(['--format=json'])
    assert.equal(stdoutResult.status, 0, `expected exit 0, got ${stdoutResult.status}\n${stdoutResult.stderr}`)

    const outputResult = runExportMemo(['--format=json', '--output', outputPath])
    assert.equal(outputResult.status, 0, `expected exit 0, got ${outputResult.status}\n${outputResult.stderr}`)
    assert.equal(outputResult.stdout, '')
    assert.equal(readFileSync(outputPath, 'utf8'), stdoutResult.stdout)
    assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), JSON.parse(stdoutResult.stdout))
    assert.equal(readFileSync(liveSnapshotUrl, 'utf8'), liveSnapshotBefore)
    assert.equal(readFileSync(historySnapshotsUrl, 'utf8'), historySnapshotsBefore)
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})


test('exportMemo CLI: --output 可写入 repo-local 临时目录且不泄漏路径', () => {
  const repoTempPrefix = fileURLToPath(new URL('../.tmp-memo-export-', import.meta.url))
  const outputDir = mkdtempSync(repoTempPrefix)
  const outputPath = join(outputDir, 'memo.md')

  try {
    const result = runExportMemo(['--format=markdown', '--output', outputPath])
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')

    const memoText = readFileSync(outputPath, 'utf8')
    assert.match(memoText, /^# ETF 512400 研究备忘/m)
    assert.doesNotMatch(memoText, /undefined|NaN|Infinity/)
    assert.doesNotMatch(memoText, /\.tmp-memo-export-|\/tmp\/|\/var\/folders\//)
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

test('exportMemo CLI: --output 拒绝覆盖受保护的数据 JSON', () => {
  for (const protectedUrl of [liveSnapshotUrl, historySnapshotsUrl]) {
    const protectedBefore = readFileSync(protectedUrl, 'utf8')
    const result = runExportMemo(['--output', fileURLToPath(protectedUrl)])
    assert.notEqual(result.status, 0, 'protected data JSON output should exit non-zero')
    assert.match(result.stderr, /protected data file/i)
    assert.equal(result.stdout, '')
    assert.equal(readFileSync(protectedUrl, 'utf8'), protectedBefore)
  }
})

test('exportMemo CLI: --output 拒绝通过符号链接覆盖受保护的数据 JSON', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'etf-memo-export-link-'))
  const linkedOutputPath = join(outputDir, 'linked-live-snapshot.json')
  const liveSnapshotBefore = readFileSync(liveSnapshotUrl, 'utf8')

  try {
    symlinkSync(fileURLToPath(liveSnapshotUrl), linkedOutputPath)
    const result = runExportMemo(['--output', linkedOutputPath])
    assert.notEqual(result.status, 0, 'symlink to protected data JSON should exit non-zero')
    assert.match(result.stderr, /protected data file/i)
    assert.equal(result.stdout, '')
    assert.equal(readFileSync(liveSnapshotUrl, 'utf8'), liveSnapshotBefore)
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

test('exportMemo CLI: --output 写入失败时不打印 Node 堆栈', () => {
  const result = runExportMemo(['--output', '.'])
  assert.notEqual(result.status, 0, 'directory output should exit non-zero')
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Unable to write memo output/i)
  assert.doesNotMatch(result.stderr, /Error:|at async|node:internal/i)
})

test('exportMemo CLI: --output 父目录不存在时退出码非零、stderr 干净不含 Node 堆栈或 errno 细节', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'etf-memo-export-no-parent-'))
  const missingParentPath = join(outputDir, 'does-not-exist-yet', 'memo.md')

  try {
    const result = runExportMemo(['--output', missingParentPath])
    assert.notEqual(result.status, 0, 'missing parent dir should exit non-zero')
    assert.equal(result.stdout, '', 'stdout 必须为空')
    assert.match(result.stderr, /Unable to write memo output/i)
    assert.doesNotMatch(
      result.stderr,
      /Error:|at async|node:internal|ENOENT|errno|syscall/i,
      'stderr 不应含 Node 堆栈或 errno/syscall 细节',
    )
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

test('exportMemo CLI: 未知 --format 时退出码非零并报错', () => {
  const result = runExportMemo(['--format=yaml'])
  assert.notEqual(result.status, 0, 'unknown format should exit non-zero')
  assert.match(result.stderr, /format/i)
})

test('exportMemo CLI: 重复 --format 时退出码非零并提示只传一次', () => {
  const result = runExportMemo(['--format=json', '--format=text'])
  assert.notEqual(result.status, 0, 'duplicate format should exit non-zero')
  assert.match(result.stderr, /--format only once/i)
  assert.equal(result.stdout, '')
})

test('exportMemo CLI: 重复 --output 时退出码非零、stdout 为空且 stderr 不打印 Node 堆栈或路径', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'etf-memo-export-dup-out-'))
  const firstPath = join(outputDir, 'first.md')
  const secondPath = join(outputDir, 'second.md')

  try {
    const result = runExportMemo(['--output', firstPath, '--output', secondPath])
    assert.notEqual(result.status, 0, 'duplicate --output should exit non-zero')
    assert.match(result.stderr, /--output only once/i)
    assert.equal(result.stdout, '')
    assert.doesNotMatch(result.stderr, /Error:|at async|node:internal/i)
    assert.equal(result.stderr.includes(firstPath), false, 'stderr should not leak first --output path')
    assert.equal(result.stderr.includes(secondPath), false, 'stderr should not leak second --output path')
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

test('exportMemo CLI: 重复 --output 在 --output=<path> 与混合形式下同样安全拒绝', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'etf-memo-export-dup-out-eq-'))
  const firstPath = join(outputDir, 'first.md')
  const secondPath = join(outputDir, 'second.md')

  try {
    const argVariants = [
      [`--output=${firstPath}`, `--output=${secondPath}`],
      ['--output', firstPath, `--output=${secondPath}`],
      [`--output=${firstPath}`, '--output', secondPath],
    ]
    for (const args of argVariants) {
      const label = args.join(' ')
      const result = runExportMemo(args)
      assert.notEqual(result.status, 0, `[${label}] duplicate --output should exit non-zero`)
      assert.equal(result.stdout, '', `[${label}] stdout 必须为空`)
      assert.match(result.stderr, /--output only once/i, `[${label}] stderr 应提示只传一次`)
      assert.doesNotMatch(result.stderr, /Error:|at async|node:internal/i, `[${label}] stderr 不应含 Node 堆栈`)
      assert.equal(result.stderr.includes(firstPath), false, `[${label}] stderr 不应泄漏首个 --output 路径`)
      assert.equal(result.stderr.includes(secondPath), false, `[${label}] stderr 不应泄漏第二个 --output 路径`)
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

test('exportMemo CLI: 三种 format 输出无 undefined/NaN/Infinity 哨兵且 stderr 干净', () => {
  for (const format of ['markdown', 'json', 'text']) {
    const result = runExportMemo([`--format=${format}`])
    assert.equal(result.status, 0, `[${format}] expected exit 0, got ${result.status}\n${result.stderr}`)
    assert.equal(result.stderr, '', `[${format}] stderr 应为空，得到: ${result.stderr}`)
    assert.ok(result.stdout.length > 0, `[${format}] stdout 不能为空`)
    for (const sentinel of ['undefined', 'NaN', 'Infinity']) {
      assert.equal(
        result.stdout.includes(sentinel),
        false,
        `[${format}] stdout 不应包含 "${sentinel}" 哨兵字符串:\n${result.stdout}`,
      )
    }
  }
})
