import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatMemoMarkdown,
  formatMemoText,
} from '../src/analysis/memoFormatter.js'

const baseMemo = {
  headline: '主仓持有（仓位 60%）',
  drivers: [
    '信号 小仓跟踪（70）',
    '交易质量 可正常执行（78）',
    '趋势 上升趋势',
  ],
  reasons: [
    '趋势状态：上升趋势，20日+5.0%，60日+12.0%',
    '折溢价：+0.10%，成交额8.00亿',
  ],
  invalidations: [
    '价格跌破60日均线且商品驱动没有修复，信号降为风险降档',
    '折溢价高于0.8%或单日急涨超过4.5%，禁止新增追价仓位',
  ],
  metrics: {
    score: 78,
    exposure: 0.6,
    confidence: 75,
    premium: 0.001,
    dailyChange: 0.012,
  },
  source: '自动优化',
  rule: '20/60日趋势，5%/12%回撤',
  tone: 'positive',
}

test('formatMemoMarkdown: 含标题、副标题、四大区块', () => {
  const md = formatMemoMarkdown(baseMemo)
  assert.match(md, /^# ETF 512400 研究备忘/m)
  assert.match(md, /^## 主仓持有（仓位 60%）/m)
  assert.match(md, /^### 解释链/m)
  assert.match(md, /^### 关键依据/m)
  assert.match(md, /^### 失效条件/m)
  assert.match(md, /^### 指标/m)
})

test('formatMemoMarkdown: drivers/reasons/invalidations 渲染为列表', () => {
  const md = formatMemoMarkdown(baseMemo)
  for (const driver of baseMemo.drivers) {
    assert.ok(md.includes(`- ${driver}`), `markdown should list driver ${driver}`)
  }
  for (const reason of baseMemo.reasons) {
    assert.ok(md.includes(`- ${reason}`), `markdown should list reason ${reason}`)
  }
  for (const rule of baseMemo.invalidations) {
    assert.ok(md.includes(`- ${rule}`), `markdown should list invalidation ${rule}`)
  }
})

test('formatMemoMarkdown: 指标区显示百分比与来源/规则', () => {
  const md = formatMemoMarkdown(baseMemo)
  assert.match(md, /评分.*78/)
  assert.match(md, /仓位.*60%/)
  assert.match(md, /置信度.*75/)
  assert.match(md, /折溢价.*\+?0\.10%/)
  assert.match(md, /当日涨跌.*\+?1\.20%/)
  assert.match(md, /来源.*自动优化/)
  assert.match(md, /规则.*20\/60日趋势/)
})

test('formatMemoMarkdown: 缺少 reasons/invalidations 时仍生成有效输出', () => {
  const sparse = {
    ...baseMemo,
    reasons: [],
    invalidations: [],
  }
  const md = formatMemoMarkdown(sparse)
  assert.match(md, /^### 关键依据/m)
  assert.match(md, /^### 失效条件/m)
  assert.match(md, /暂无/)
})

test('formatMemoMarkdown: 缺失 metrics 字段时显示 暂无 而非 NaN/undefined', () => {
  const memo = {
    ...baseMemo,
    metrics: { score: 50, exposure: 0.3, confidence: NaN, premium: null, dailyChange: undefined },
  }
  const md = formatMemoMarkdown(memo)
  assert.ok(!md.includes('NaN'), 'markdown should not leak NaN')
  assert.ok(!md.includes('undefined'), 'markdown should not leak undefined')
  assert.ok(md.includes('暂无'), 'markdown should fallback to 暂无')
})

test('formatMemoText: 单行摘要 含动作/仓位/信号/质量/趋势', () => {
  const text = formatMemoText(baseMemo)
  assert.equal(text.split('\n').length, 1, 'text format should be a single line')
  assert.ok(text.includes('主仓持有'))
  assert.ok(text.includes('60%'))
  assert.ok(text.includes('小仓跟踪'))
  assert.ok(text.includes('可正常执行'))
  assert.ok(text.includes('上升趋势'))
})

test('formatMemoText: warning tone 时附带风险前缀', () => {
  const warningMemo = { ...baseMemo, tone: 'warning', headline: '禁止追高（仓位 10%）' }
  const text = formatMemoText(warningMemo)
  assert.match(text, /^\[警告\]/)
  assert.ok(text.includes('禁止追高'))
})
