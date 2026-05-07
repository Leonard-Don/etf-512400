import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const scriptUrl = new URL('../scripts/exportMemo.mjs', import.meta.url)
const scriptPath = fileURLToPath(scriptUrl)
const packageUrl = new URL('../package.json', import.meta.url)

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

test('exportMemo CLI: 未知 --format 时退出码非零并报错', () => {
  const result = runExportMemo(['--format=yaml'])
  assert.notEqual(result.status, 0, 'unknown format should exit non-zero')
  assert.match(result.stderr, /format/i)
})
