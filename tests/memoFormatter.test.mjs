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

test('formatMemoMarkdown/Text: 缺少三类列表字段时保留区块与 fallback 文案', () => {
  const sparse = {
    headline: '观察持有（仓位 暂无）',
    metrics: {
      score: Number.NaN,
      exposure: undefined,
      confidence: null,
      premium: undefined,
      dailyChange: Number.NaN,
    },
  }

  const md = formatMemoMarkdown(sparse)
  assert.match(md, /^### 解释链\n暂无/m)
  assert.match(md, /^### 关键依据\n暂无/m)
  assert.match(md, /^### 失效条件\n暂无/m)
  assert.match(md, /评分:\s*暂无/)
  assert.match(md, /仓位:\s*暂无/)
  assert.match(md, /置信度:\s*暂无/)
  assert.ok(!md.includes('undefined'), 'markdown should not leak undefined for missing list fields')
  assert.ok(!md.includes('NaN'), 'markdown should not leak NaN for non-finite sparse metrics')

  const text = formatMemoText(sparse)
  assert.equal(text.split('\n').length, 1, 'text format should stay a single line')
  assert.ok(text.includes(sparse.headline), 'text format should still include headline')
  assert.ok(!text.includes('undefined'), 'text should not leak undefined when drivers are missing')
  assert.ok(!text.includes('NaN'), 'text should not leak NaN when drivers are missing')
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

test('formatMemoMarkdown/Text: 零值/0% 等 sparse-but-valid 字段应原样渲染，而非被当作缺失', () => {
  // 当指标合法地为 0（如 0% 仓位、平盘 0.00% 当日涨跌、0 分中性日），必须按 0 渲染。
  // 守卫 `if (!value)` 之类的截断式实现把 0 误判为缺失而回退到 暂无 占位。
  const zeroMemo = {
    headline: '观察持有（仓位 0%）',
    drivers: ['信号 暂时观望（0）', '交易质量 平稳（0）', '趋势 横盘'],
    reasons: ['折溢价：+0.00%'],
    invalidations: ['价格跌破60日均线触发降档'],
    metrics: {
      score: 0,
      exposure: 0,
      confidence: 0,
      premium: 0,
      dailyChange: 0,
    },
    source: '自动优化',
    rule: '20/60日趋势',
    tone: 'neutral',
  }

  const md = formatMemoMarkdown(zeroMemo)
  assert.match(md, /评分:\s*0$/m, 'metrics.score=0 应渲染为 0 而非 暂无')
  assert.match(md, /仓位:\s*0%$/m, 'metrics.exposure=0 应渲染为 0% 而非 暂无')
  assert.match(md, /置信度:\s*0$/m, 'metrics.confidence=0 应渲染为 0 而非 暂无')
  assert.match(md, /折溢价:\s*0\.00%$/m, 'metrics.premium=0 应渲染为 0.00% 而非 暂无')
  assert.match(md, /当日涨跌:\s*0\.00%$/m, 'metrics.dailyChange=0 应渲染为 0.00% 而非 暂无')
  assert.ok(!md.includes('暂无'), '全部字段均为合法值（含 0），不应出现 暂无 占位')

  const text = formatMemoText(zeroMemo)
  assert.equal(text.split('\n').length, 1, '单行摘要')
  assert.ok(text.includes('观察持有'), '应保留 headline')
  assert.ok(text.includes('信号 暂时观望（0）'), '零值的 driver 文案应原样保留')
  assert.equal(text.startsWith('[警告]'), false, 'neutral tone 不应触发 [警告] 前缀')
})

test('formatMemoMarkdown: 同一 metrics 中 0 与缺失值并存时按字段独立渲染，互不串味', () => {
  // 守卫 `if (!value)` 类截断式判断：0 不能被误归到 暂无。
  // 当 score/exposure/dailyChange=0（合法稀疏）与 confidence=NaN/premium=undefined（真缺失）
  // 共存于同一 metrics 时，每个字段必须按其自身语义独立渲染。
  const memo = {
    headline: '观察持有（仓位 0%）',
    drivers: ['信号 暂时观望（0）', '交易质量 平稳（55）', '趋势 横盘'],
    reasons: ['折溢价：+0.00%'],
    invalidations: ['价格跌破60日均线触发降档'],
    metrics: {
      score: 0,
      exposure: 0,
      confidence: Number.NaN,
      premium: undefined,
      dailyChange: 0,
    },
    source: '自动优化',
    rule: '20/60日趋势',
    tone: 'neutral',
  }

  const md = formatMemoMarkdown(memo)
  assert.match(md, /^- 评分: 0$/m, 'score=0 必须渲染为 0，不被截断式守卫归到 暂无')
  assert.match(md, /^- 仓位: 0%$/m, 'exposure=0 必须渲染为 0%')
  assert.match(md, /^- 当日涨跌: 0\.00%$/m, 'dailyChange=0 必须渲染为 0.00%')
  assert.match(md, /^- 置信度: 暂无$/m, 'confidence=NaN 必须独立回退到 暂无')
  assert.match(md, /^- 折溢价: 暂无$/m, 'premium=undefined 必须独立回退到 暂无')
  assert.ok(!md.includes('NaN'), 'markdown 不应泄漏 NaN 哨兵')
  assert.ok(!md.includes('undefined'), 'markdown 不应泄漏 undefined 哨兵')
})

test('formatMemoMarkdown/Text: 顶层 source/rule/tone 与整个 metrics 对象缺失时仍稳定渲染', () => {
  // 上游 memo 在离线/降级路径下可能不带 source/rule/tone，且 metrics 对象整体缺失。
  // 守卫这些场景下不泄漏 undefined/NaN，并稳定渲染 "暂无" 占位与无前缀单行摘要。
  const partial = {
    headline: '观察持有（仓位 30%）',
    drivers: ['信号 小仓跟踪（55）', '交易质量 谨慎（60）', '趋势 震荡'],
    reasons: ['折溢价：+0.10%'],
    invalidations: ['价格跌破60日均线'],
  }

  const md = formatMemoMarkdown(partial)
  assert.ok(!md.includes('undefined'), 'markdown 缺失顶层字段时不应泄漏 undefined')
  assert.ok(!md.includes('NaN'), 'markdown 缺失 metrics 对象时不应泄漏 NaN')
  assert.match(md, /来源:\s*暂无/, 'source 缺失应回退到 暂无')
  assert.match(md, /规则:\s*暂无/, 'rule 缺失应回退到 暂无')
  assert.match(md, /风险标签:\s*暂无/, 'tone 缺失应回退到 暂无')
  assert.match(md, /评分:\s*暂无/, 'metrics 整体缺失时 score 应回退到 暂无')
  assert.match(md, /仓位:\s*暂无/, 'metrics 整体缺失时 exposure 应回退到 暂无')
  assert.match(md, /置信度:\s*暂无/, 'metrics 整体缺失时 confidence 应回退到 暂无')
  assert.match(md, /折溢价:\s*暂无/, 'metrics 整体缺失时 premium 应回退到 暂无')
  assert.match(md, /当日涨跌:\s*暂无/, 'metrics 整体缺失时 dailyChange 应回退到 暂无')

  const text = formatMemoText(partial)
  assert.ok(!text.includes('undefined'), 'text 缺失 tone/drivers 时不应泄漏 undefined')
  assert.equal(text.startsWith('[警告]'), false, '缺失 tone 不应触发 [警告] 前缀')
  assert.ok(text.includes(partial.headline), '单行摘要仍应包含 headline')
})
