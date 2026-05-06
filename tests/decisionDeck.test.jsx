import { describe, expect, test } from 'vitest'
import { DecisionDeck } from '../src/components/DecisionDeck.jsx'
import { render } from './helpers/render.jsx'

const baseProps = {
  dailyChange: 0.012,
  premium: 0.003,
  primaryDecision: {
    action: '小仓跟踪',
    tone: 'positive',
    source: '自动优化',
    rule: '20/60日趋势，5%/12%回撤',
    exposure: 0.42,
    score: 78,
    overfitRisk: '低',
    stabilityScore: 72,
  },
  signal: {
    suggestedExposure: 0.4,
    action: '小仓跟踪',
    factorProfile: { highRiskFactors: 1 },
  },
  topRiskDrivers: [
    { key: 'gold', label: '黄金', riskScore: 78, return20: 0.05 },
    { key: 'copper', label: '铜', riskScore: 65, return20: -0.02 },
    { key: 'lithium', label: '锂', riskScore: 60, return20: 0.01 },
  ],
  trendProfile: { state: '上升趋势', drawdownFromHigh60: -0.04 },
}

describe('DecisionDeck', () => {
  test('renders the full snapshot mode without throwing', () => {
    const { html, unmount } = render(<DecisionDeck {...baseProps} />)
    const out = html()
    expect(out).toContain('今日决策台')
    expect(out).toContain('小仓跟踪')
    expect(out).toContain('自动优化')
    expect(out).toContain('上升趋势')
    expect(out).toContain('黄金')
    expect(out).toContain('today-card primary positive')
    unmount()
  })

  test('warning tone renders warning class on the primary card', () => {
    const { html, unmount } = render(
      <DecisionDeck
        {...baseProps}
        primaryDecision={{
          ...baseProps.primaryDecision,
          action: '禁止追高',
          tone: 'warning',
          rule: '20/60日趋势 · 信号 禁止追高',
          exposure: 0.12,
        }}
        signal={{
          suggestedExposure: 0.12,
          action: '禁止追高',
          factorProfile: { highRiskFactors: 3 },
        }}
      />,
    )
    const out = html()
    expect(out).toContain('today-card primary warning')
    expect(out).toContain('禁止追高')
    unmount()
  })

  test('empty risk-driver list renders panel without crashing', () => {
    const { html, unmount } = render(<DecisionDeck {...baseProps} topRiskDrivers={[]} />)
    const out = html()
    expect(out).toContain('商品驱动')
    expect(out).not.toContain('黄金')
    unmount()
  })

  test('non-finite drawdown still renders (formatter falls back)', () => {
    const { html, unmount } = render(
      <DecisionDeck
        {...baseProps}
        trendProfile={{ state: '样本不足', drawdownFromHigh60: NaN }}
      />,
    )
    expect(html()).toContain('样本不足')
    unmount()
  })

  test('factorProfile with zero high-risk factors shows 0个', () => {
    const { html, unmount } = render(
      <DecisionDeck
        {...baseProps}
        signal={{
          suggestedExposure: 0.5,
          action: '小仓跟踪',
          factorProfile: { highRiskFactors: 0 },
        }}
      />,
    )
    expect(html()).toContain('0个')
    unmount()
  })
})
