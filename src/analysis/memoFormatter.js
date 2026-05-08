// 把 composeResearchMemo 的结构化输出渲染为 Markdown / 单行文本，便于本地导出与对话粘贴。
// 仅依赖 memo 对象，不读数据，保持纯函数。
import { formatSignedPercent } from './formatters.js'

const TONE_PREFIX = {
  warning: '[警告] ',
  neutral: '',
  positive: '',
}

function formatScore(value) {
  return Number.isFinite(value) ? String(value) : '暂无'
}

function formatExposure(value) {
  if (!Number.isFinite(value)) return '暂无'
  return `${Math.round(value * 100)}%`
}

function bulletList(items, fallback = '暂无') {
  if (!Array.isArray(items) || items.length === 0) return fallback
  return items.map((item) => `- ${item}`).join('\n')
}

export function formatMemoMarkdown(memo) {
  const metrics = memo.metrics ?? {}
  const lines = [
    '# ETF 512400 研究备忘',
    '',
    `## ${memo.headline}`,
    '',
    '### 解释链',
    bulletList(memo.drivers),
    '',
    '### 关键依据',
    bulletList(memo.reasons),
    '',
    '### 失效条件',
    bulletList(memo.invalidations),
    '',
    '### 指标',
    `- 评分: ${formatScore(metrics.score)}`,
    `- 仓位: ${formatExposure(metrics.exposure)}`,
    `- 置信度: ${formatScore(metrics.confidence)}`,
    `- 折溢价: ${formatSignedPercent(metrics.premium)}`,
    `- 当日涨跌: ${formatSignedPercent(metrics.dailyChange)}`,
    `- 来源: ${memo.source ?? '暂无'}`,
    `- 规则: ${memo.rule ?? '暂无'}`,
    `- 风险标签: ${memo.tone ?? '暂无'}`,
  ]
  return lines.join('\n')
}

export function formatMemoText(memo) {
  const prefix = TONE_PREFIX[memo.tone] ?? ''
  const drivers = (memo.drivers ?? []).join(' | ')
  return `${prefix}${memo.headline}｜${drivers}`
}
