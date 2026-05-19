import { describe, expect, test } from 'vitest'
import { buildStrategyOptimizer } from '../src/analysis/optimizer.js'
import { buildProviderFreshnessRegistry } from '../src/analysis/snapshotHealth.js'
import { DataFreshnessDrilldown } from '../src/components/QualityPanels.jsx'
import { StrategyOptimizer } from '../src/components/StrategyPanels.jsx'
import { render } from './helpers/render.jsx'

const baseFactors = [
  { trend: 65, risk: 50, weight: 30 },
  { trend: 60, risk: 55, weight: 30 },
  { trend: 55, risk: 60, weight: 20 },
  { trend: 50, risk: 50, weight: 20 },
]

function syntheticKlines(days, generator) {
  const start = new Date('2024-01-01')
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return { date: date.toISOString().slice(0, 10), close: generator(index) }
  })
}

describe('DataFreshnessDrilldown', () => {
  test('renders core, auxiliary, cache, failure and next-action details', () => {
    const registry = buildProviderFreshnessRegistry({
      quoteTradeDate: '2026-05-06',
      navDate: '2026-05-06',
      now: new Date('2026-05-06T04:00:00Z'),
      sourceHealth: [
        { id: 'quote', label: '实时ETF行情', required: true, ok: true, runtime: true },
        { id: 'fundGauge', label: '估算净值', ok: false, fallback: true },
        { id: 'macro', label: '宏观利率', ok: false, fallback: false },
      ],
    })

    const { html, unmount } = render(<DataFreshnessDrilldown registry={registry} />)
    const out = html()
    expect(out).toContain('数据源新鲜度')
    expect(out).toContain('核心源 1 个，辅助源 2 个，缓存 1 个，失败 1 个')
    expect(out).toContain('实时ETF行情')
    expect(out).toContain('估算净值')
    expect(out).toContain('宏观利率')
    expect(out).toContain('缓存只作旁证')
    expect(out).toContain('失败无缓存')
    unmount()
  })
})

describe('StrategyOptimizer surface explanations', () => {
  test('renders stable-zone explanation, overfit copy and leaderboard rationale', () => {
    const klines = syntheticKlines(260, (index) => 100 * 1.0006 ** index)
    const optimizer = buildStrategyOptimizer({ klines, factorBaskets: baseFactors })

    const { html, unmount } = render(<StrategyOptimizer optimizer={optimizer} />)
    const out = html()
    expect(out).toContain('稳定参数区间')
    expect(out).toContain('头部')
    expect(out).toContain('当前原始仓位')
    expect(out).toContain('样本外仓位')
    expect(out).toContain('推荐它是因为')
    expect(out).toContain(optimizer.parameterSurface.dispersionLabel)
    unmount()
  })
})
