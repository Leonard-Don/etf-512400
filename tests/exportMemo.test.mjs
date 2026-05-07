import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
