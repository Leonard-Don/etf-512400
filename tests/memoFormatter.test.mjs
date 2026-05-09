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

test('formatMemoMarkdown/Text: metrics 为 ±Infinity 时回退到 暂无 不漏 Infinity 字面量', () => {
  // 上游若发生除零或溢出（如分母为 0 的 dailyChange/premium 计算），metrics 可能变成 ±Infinity；
  // formatScore/formatExposure/formatSignedPercent 都基于 Number.isFinite 守卫，必须把这些非有限值
  // 统一回退到 暂无，不能让 Infinity/-Infinity 字面量漏到 markdown 或单行摘要里。
  // 该用例守卫未来若有人把守卫改成 `if (!value)` 或 `Number.isNaN(value)` 之类更窄的检查
  // 而让 ±Infinity 直接 String() 漏到产物中。
  const overflowMemo = {
    ...baseMemo,
    metrics: {
      score: Infinity,
      exposure: -Infinity,
      confidence: Infinity,
      premium: -Infinity,
      dailyChange: Infinity,
    },
  }

  const md = formatMemoMarkdown(overflowMemo)
  assert.match(md, /^- 评分:\s*暂无$/m, 'score=Infinity 必须回退到 暂无')
  assert.match(md, /^- 仓位:\s*暂无$/m, 'exposure=-Infinity 必须回退到 暂无')
  assert.match(md, /^- 置信度:\s*暂无$/m, 'confidence=Infinity 必须回退到 暂无')
  assert.match(md, /^- 折溢价:\s*暂无$/m, 'premium=-Infinity 必须回退到 暂无')
  assert.match(md, /^- 当日涨跌:\s*暂无$/m, 'dailyChange=Infinity 必须回退到 暂无')
  assert.ok(!md.includes('Infinity'), 'markdown 不应泄漏 Infinity/-Infinity 字面量')
  assert.ok(!md.includes('NaN'), 'markdown 不应泄漏 NaN 字面量')
  assert.ok(!md.includes('undefined'), 'markdown 不应泄漏 undefined 字面量')

  const text = formatMemoText(overflowMemo)
  assert.equal(text.split('\n').length, 1, '指标溢出仍保持单行摘要')
  assert.ok(!text.includes('Infinity'), 'text 不应泄漏 Infinity/-Infinity 字面量')
  assert.ok(!text.includes('NaN'), 'text 不应泄漏 NaN 字面量')
  assert.ok(!text.includes('undefined'), 'text 不应泄漏 undefined 字面量')
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

test('formatMemoMarkdown: live memo（replaySelection=null）不渲染归档来源区块', () => {
  // live memo 的 composeResearchMemo 输出 replaySelection=null；markdown 应保持原有四大区块，
  // 不引入"归档来源"区块，避免在实时备忘里写出无意义的"未指定/未命中"占位。
  const liveMemo = { ...baseMemo, replaySelection: null }
  const md = formatMemoMarkdown(liveMemo)
  assert.doesNotMatch(md, /^###\s*归档来源/m, 'live memo 不应出现归档来源区块')
  assert.doesNotMatch(md, /命中日期|请求 as-of/, 'live memo 不应出现归档来源字段')
})

test('formatMemoMarkdown: replaySelection 字段缺失时不渲染归档来源区块', () => {
  // baseMemo 不带 replaySelection 字段（兼容旧数据）；markdown 必须保持稳定，
  // 不被新增的归档来源逻辑污染。
  const md = formatMemoMarkdown(baseMemo)
  assert.doesNotMatch(md, /^###\s*归档来源/m, 'replaySelection 缺失时不应出现归档来源区块')
})

test('formatMemoMarkdown: 命中归档时渲染归档来源区块（请求/命中/生成时间/可用日期）', () => {
  // archived memo 必须把 replaySelection 暴露在 markdown 里，给阅读者 traceability。
  // 仅 JSON 暴露而 markdown 缺失，会让 --as-of 导出变得无法审计。
  const archivedMemo = {
    ...baseMemo,
    replaySelection: {
      requestedAsOf: '2026-04-29',
      matchedDate: '2026-04-29',
      matchedGeneratedAt: '2026-04-29T07:00:00.000Z',
      fallbackReason: null,
      availableDates: ['2026-04-28', '2026-04-29', '2026-04-30'],
      dedupedDates: [],
    },
  }
  const md = formatMemoMarkdown(archivedMemo)
  assert.match(md, /^###\s*归档来源/m, 'archived memo 必须包含归档来源区块')
  assert.match(md, /^- 请求 as-of:\s*2026-04-29$/m, '请求 as-of 必须回显')
  assert.match(md, /^- 命中日期:\s*2026-04-29$/m, '命中日期必须回显')
  assert.match(md, /^- 生成时间:\s*2026-04-29T07:00:00\.000Z$/m, '生成时间必须回显 ISO')
  assert.match(
    md,
    /^- 可用日期:\s*2026-04-28,\s*2026-04-29,\s*2026-04-30$/m,
    '可用日期必须按归档顺序列出',
  )
  assert.doesNotMatch(md, /^- 回退原因:/m, 'fallbackReason=null 时不应出现回退原因行')
  assert.doesNotMatch(md, /^- 去重日期:/m, 'dedupedDates=[] 时不应出现去重日期行')
})

test('formatMemoMarkdown: requestedAsOf=null 时显示 未指定 而非 null/undefined', () => {
  const archivedMemo = {
    ...baseMemo,
    replaySelection: {
      requestedAsOf: null,
      matchedDate: '2026-04-30',
      matchedGeneratedAt: '2026-04-30T06:29:39.104Z',
      fallbackReason: 'no-as-of',
      availableDates: ['2026-04-28', '2026-04-30'],
      dedupedDates: [],
    },
  }
  const md = formatMemoMarkdown(archivedMemo)
  assert.match(md, /^- 请求 as-of:\s*未指定$/m, 'requestedAsOf=null 渲染为 未指定')
  assert.match(md, /^- 回退原因:\s*no-as-of$/m, 'fallbackReason 非空时必须回显')
  assert.ok(!md.includes('null'), 'markdown 不应泄漏 null 字面量')
  assert.ok(!md.includes('undefined'), 'markdown 不应泄漏 undefined 字面量')
})

test('formatMemoMarkdown: matchedDate/matchedGeneratedAt=null 时使用占位文案不漏 null', () => {
  const archivedMemo = {
    ...baseMemo,
    replaySelection: {
      requestedAsOf: '2099-12-31',
      matchedDate: null,
      matchedGeneratedAt: null,
      fallbackReason: 'no-match',
      availableDates: ['2026-04-29', '2026-04-30'],
      dedupedDates: [],
    },
  }
  const md = formatMemoMarkdown(archivedMemo)
  assert.match(md, /^- 命中日期:\s*未命中$/m, 'matchedDate=null 渲染为 未命中')
  assert.match(md, /^- 生成时间:\s*暂无$/m, 'matchedGeneratedAt=null 渲染为 暂无')
  assert.match(md, /^- 回退原因:\s*no-match$/m, 'fallbackReason=no-match 必须回显')
  assert.ok(!md.includes('null'), 'markdown 不应泄漏 null 字面量')
})

test('formatMemoMarkdown/Text: 旧档命中（matchedDate 有效但 matchedGeneratedAt=null）不漏 null 且保留来源标记', () => {
  // PR #3 之前归档的快照可能没有 generatedAt 字段；命中后 matchedDate 仍是有效 ISO 日期，
  // 但 matchedGeneratedAt 为 null。markdown 必须在 生成时间 行用 "暂无" 占位、命中日期/可用日期/请求 as-of
  // 不受影响；text 仍要带 归档自 matchedDate 后缀让历史复盘可追溯，不能让 null 漏到任一格式。
  const legacyArchivedMemo = {
    ...baseMemo,
    replaySelection: {
      requestedAsOf: '2026-04-30',
      matchedDate: '2026-04-30',
      matchedGeneratedAt: null,
      fallbackReason: null,
      availableDates: ['2026-04-29', '2026-04-30'],
      dedupedDates: [],
    },
  }

  const md = formatMemoMarkdown(legacyArchivedMemo)
  assert.match(md, /^###\s*归档来源/m, '旧档命中仍必须渲染归档来源区块')
  assert.match(md, /^- 请求 as-of:\s*2026-04-30$/m, '请求 as-of 必须正常回显')
  assert.match(md, /^- 命中日期:\s*2026-04-30$/m, '命中日期必须正常回显，不受 generatedAt 缺失影响')
  assert.match(md, /^- 生成时间:\s*暂无$/m, 'matchedGeneratedAt=null 必须回退到 暂无 占位')
  assert.match(md, /^- 可用日期:\s*2026-04-29,\s*2026-04-30$/m, '可用日期不受 generatedAt 缺失影响')
  assert.doesNotMatch(md, /^- 回退原因:/m, 'fallbackReason=null 时不应出现回退原因行')
  assert.ok(!md.includes('null'), 'markdown 不应泄漏 null 字面量')
  assert.ok(!md.includes('undefined'), 'markdown 不应泄漏 undefined 字面量')

  const text = formatMemoText(legacyArchivedMemo)
  assert.equal(text.split('\n').length, 1, '旧档命中仍是单行摘要')
  assert.ok(text.endsWith('｜归档自 2026-04-30'), '只要 matchedDate 有效，text 仍以 归档自 matchedDate 结尾')
  assert.ok(!text.includes('null'), 'text 不应泄漏 null 字面量')
  assert.ok(!text.includes('undefined'), 'text 不应泄漏 undefined 字面量')
  assert.ok(!text.includes('暂无'), 'text 单行摘要不应把 markdown 的 暂无 占位漏出来')
})

test('formatMemoMarkdown: dedupedDates 非空时单独列出去重日期供审计', () => {
  const archivedMemo = {
    ...baseMemo,
    replaySelection: {
      requestedAsOf: '2026-04-30',
      matchedDate: '2026-04-30',
      matchedGeneratedAt: '2026-04-30T08:00:00.000Z',
      fallbackReason: null,
      availableDates: ['2026-04-29', '2026-04-30'],
      dedupedDates: ['2026-04-30'],
    },
  }
  const md = formatMemoMarkdown(archivedMemo)
  assert.match(md, /^- 去重日期:\s*2026-04-30$/m, 'dedupedDates 非空时必须暴露')
})

test('formatMemoMarkdown: availableDates 缺失或非数组时显示 (无) 占位', () => {
  for (const variant of [undefined, null, 42, 'archive']) {
    const archivedMemo = {
      ...baseMemo,
      replaySelection: {
        requestedAsOf: '2026-04-30',
        matchedDate: '2026-04-30',
        matchedGeneratedAt: '2026-04-30T06:29:39.104Z',
        fallbackReason: null,
        availableDates: variant,
        dedupedDates: [],
      },
    }
    const md = formatMemoMarkdown(archivedMemo)
    assert.match(
      md,
      /^- 可用日期:\s*\(无\)$/m,
      `availableDates=${JSON.stringify(variant)} 应显示 (无) 占位`,
    )
    assert.ok(!md.includes('undefined'), 'markdown 不应泄漏 undefined')
    assert.ok(!md.includes('null'), 'markdown 不应泄漏 null')
  }
})

test('formatMemoMarkdown: 空 availableDates 数组显示 (无) 占位而非空字符串', () => {
  const archivedMemo = {
    ...baseMemo,
    replaySelection: {
      requestedAsOf: '2026-04-30',
      matchedDate: null,
      matchedGeneratedAt: null,
      fallbackReason: 'no-frames',
      availableDates: [],
      dedupedDates: [],
    },
  }
  const md = formatMemoMarkdown(archivedMemo)
  assert.match(md, /^- 可用日期:\s*\(无\)$/m, '空数组应显示 (无)，避免行尾空白')
})

test('formatMemoText: 命中归档时附加 归档自 matchedDate 后缀且保持单行', () => {
  // 归档导出的单行摘要必须能让阅读者一眼看出"这是历史复盘，不是实时"。
  // 仅暴露 matchedDate，避免在一行里堆 availableDates/dedupedDates 噪音。
  const archivedMemo = {
    ...baseMemo,
    replaySelection: {
      requestedAsOf: '2026-04-29',
      matchedDate: '2026-04-29',
      matchedGeneratedAt: '2026-04-29T07:00:00.000Z',
      fallbackReason: null,
      availableDates: ['2026-04-28', '2026-04-29', '2026-04-30'],
      dedupedDates: [],
    },
  }
  const text = formatMemoText(archivedMemo)
  assert.equal(text.split('\n').length, 1, 'archived 单行摘要必须保持单行')
  assert.ok(text.includes(archivedMemo.headline), 'archived 单行仍包含 headline')
  assert.ok(text.endsWith('｜归档自 2026-04-29'), 'archived 单行必须以 归档自 matchedDate 结尾')
  for (const driver of archivedMemo.drivers) {
    assert.ok(text.includes(driver), `archived 单行仍包含 driver ${driver}`)
  }
  for (const date of ['2026-04-28', '2026-04-30']) {
    assert.ok(!text.includes(date), `archived 单行不应展开 availableDates 噪音 ${date}`)
  }
  assert.ok(!text.includes('可用日期'), 'archived 单行不应出现 可用日期 标签')
  assert.ok(!text.includes('去重日期'), 'archived 单行不应出现 去重日期 标签')
  assert.ok(
    !text.includes('2026-04-29T07:00:00.000Z'),
    'archived 单行不应展开 matchedGeneratedAt ISO，避免噪音',
  )
})

test('formatMemoText: live memo（replaySelection=null）不附加归档后缀，保持现有契约', () => {
  // live 单行摘要必须保持与之前完全一致，不能被新加的归档逻辑污染。
  const liveMemo = { ...baseMemo, replaySelection: null }
  const text = formatMemoText(liveMemo)
  assert.equal(text.split('\n').length, 1, 'live 单行摘要保持单行')
  assert.ok(!text.includes('归档自'), 'live memo 不应出现 归档自 后缀')
  assert.ok(!text.includes('归档'), 'live memo 不应出现 归档 字样')
})

test('formatMemoText: replaySelection 字段缺失时不附加归档后缀（兼容旧数据）', () => {
  // baseMemo 不带 replaySelection 字段（旧契约）；formatMemoText 必须保持稳定，
  // 不被新增的归档后缀逻辑污染。
  const text = formatMemoText(baseMemo)
  assert.ok(!text.includes('归档自'), 'replaySelection 缺失时不应出现 归档自 后缀')
  assert.equal(text.split('\n').length, 1, '单行不变')
})

test('formatMemoText: matchedDate=null 时不附加归档后缀（避免 未命中 漏出到单行摘要）', () => {
  // CLI 在 matchedDate=null 时会非零退出，但纯函数被直接调用时仍可能收到该形态；
  // 不应把 "未命中" 之类占位文案塞进一行摘要里造成歧义。
  const archivedMemo = {
    ...baseMemo,
    replaySelection: {
      requestedAsOf: '2099-12-31',
      matchedDate: null,
      matchedGeneratedAt: null,
      fallbackReason: 'no-match',
      availableDates: ['2026-04-29', '2026-04-30'],
      dedupedDates: [],
    },
  }
  const text = formatMemoText(archivedMemo)
  assert.equal(text.split('\n').length, 1, '即便 matchedDate 缺失也保持单行')
  assert.ok(!text.includes('归档自'), 'matchedDate=null 时不应出现 归档自 后缀')
  assert.ok(!text.includes('未命中'), 'matchedDate=null 时不应把 未命中 漏到单行摘要')
  assert.ok(!text.includes('null'), '不应泄漏 null 字面量')
  assert.ok(!text.includes('undefined'), '不应泄漏 undefined 字面量')
})

test('formatMemoText: warning tone 与归档后缀同时出现时各自独立渲染（前缀+后缀）', () => {
  // 风险归档复盘时，[警告] 前缀与 归档自 后缀都需要保留，互不抢位。
  const warningArchivedMemo = {
    ...baseMemo,
    tone: 'warning',
    headline: '禁止追高（仓位 10%）',
    replaySelection: {
      requestedAsOf: '2026-04-30',
      matchedDate: '2026-04-30',
      matchedGeneratedAt: '2026-04-30T08:00:00.000Z',
      fallbackReason: null,
      availableDates: ['2026-04-29', '2026-04-30'],
      dedupedDates: [],
    },
  }
  const text = formatMemoText(warningArchivedMemo)
  assert.equal(text.split('\n').length, 1, 'warning + 归档仍是单行')
  assert.match(text, /^\[警告\]/, 'warning tone 前缀必须保留')
  assert.ok(text.includes('禁止追高'), 'headline 仍包含')
  assert.ok(text.endsWith('｜归档自 2026-04-30'), '归档自 matchedDate 后缀必须保留')
})

test('formatMemoMarkdown: 负值 premium/dailyChange 携带原生 - 号且不附加 +', () => {
  // 折价交易（负 premium）与下跌日（负 dailyChange）是常见场景；
  // formatSignedPercent 仅对正值附加 +，负值必须保留原生 - 号且不出现 +- 这种连号。
  const downMemo = {
    ...baseMemo,
    metrics: {
      ...baseMemo.metrics,
      premium: -0.005,
      dailyChange: -0.025,
    },
  }
  const md = formatMemoMarkdown(downMemo)
  assert.match(md, /^- 折溢价:\s*-0\.50%$/m, '负 premium 渲染为 -0.50%')
  assert.match(md, /^- 当日涨跌:\s*-2\.50%$/m, '负 dailyChange 渲染为 -2.50%')
  assert.ok(!md.includes('+-'), 'markdown 不应出现 +- 连号')
  assert.ok(!md.includes('-+'), 'markdown 不应出现 -+ 连号')
})

test('formatMemoMarkdown: replaySelection={} 时仍渲染区块且每字段独立回退占位', () => {
  // 上游归档路径若交付 replaySelection={}（声明已归档但未填任何字段），
  // 必须按字段独立回退到 未指定/未命中/暂无/(无)，不漏 undefined/null。
  const archivedMemo = { ...baseMemo, replaySelection: {} }
  const md = formatMemoMarkdown(archivedMemo)
  assert.match(md, /^###\s*归档来源/m, '空 replaySelection 仍渲染区块')
  assert.match(md, /^- 请求 as-of:\s*未指定$/m, 'requestedAsOf 缺失回退到 未指定')
  assert.match(md, /^- 命中日期:\s*未命中$/m, 'matchedDate 缺失回退到 未命中')
  assert.match(md, /^- 生成时间:\s*暂无$/m, 'matchedGeneratedAt 缺失回退到 暂无')
  assert.match(md, /^- 可用日期:\s*\(无\)$/m, 'availableDates 缺失显示 (无)')
  assert.doesNotMatch(md, /^- 回退原因:/m, 'fallbackReason 缺失不应出现回退原因行')
  assert.doesNotMatch(md, /^- 去重日期:/m, 'dedupedDates 缺失不应出现去重日期行')
  assert.ok(!md.includes('undefined'), '不应泄漏 undefined')
  assert.ok(!md.includes('null'), '不应泄漏 null 字面量')
})

test('formatMemoMarkdown: replaySelection 为非对象值（字符串/数字/布尔）时不触发归档来源区块', () => {
  // 防御式守卫：若上游意外传入 replaySelection='2026-04-30' / 42 / true 等非对象值，
  // 必须按 live memo 处理，避免对原始值做 .availableDates 之类属性访问。
  for (const variant of ['2026-04-30', 42, true]) {
    const memo = { ...baseMemo, replaySelection: variant }
    const md = formatMemoMarkdown(memo)
    assert.doesNotMatch(
      md,
      /^###\s*归档来源/m,
      `replaySelection=${JSON.stringify(variant)} 不应触发归档来源区块`,
    )
  }
})

test('formatMemoMarkdown: fallbackReason="" 时不渲染回退原因行避免空尾巴', () => {
  // 上游若把 fallbackReason 显式设为 ''（命中但语义上"无回退原因"），不应出现
  // `- 回退原因: ` 这种行尾空白；其余归档字段必须正常回显不受影响。
  const memo = {
    ...baseMemo,
    replaySelection: {
      requestedAsOf: '2026-04-30',
      matchedDate: '2026-04-30',
      matchedGeneratedAt: '2026-04-30T08:00:00.000Z',
      fallbackReason: '',
      availableDates: ['2026-04-30'],
      dedupedDates: [],
    },
  }
  const md = formatMemoMarkdown(memo)
  assert.doesNotMatch(md, /^- 回退原因:/m, 'fallbackReason="" 应被视作无回退')
  assert.match(md, /^- 命中日期:\s*2026-04-30$/m, '其他归档字段不受影响')
  assert.match(md, /^- 可用日期:\s*2026-04-30$/m, 'availableDates 仍正常渲染')
})

test('formatMemoText: 未知 tone 值不触发 [警告] 前缀且不漏 undefined', () => {
  // TONE_PREFIX 仅识别 warning/neutral/positive；其他值（拼写错误或后续新增 tone）
  // 应安全降级到无前缀，且不应让 undefined 漏到单行摘要里。
  const oddMemo = { ...baseMemo, tone: 'unknown' }
  const text = formatMemoText(oddMemo)
  assert.equal(text.split('\n').length, 1, '单行不变')
  assert.equal(text.startsWith('[警告]'), false, '未知 tone 不应触发 [警告] 前缀')
  assert.ok(text.startsWith(oddMemo.headline), '应直接以 headline 开头')
  assert.ok(!text.includes('undefined'), '不应泄漏 undefined')
})
