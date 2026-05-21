import { describe, expect, test } from 'vitest'
import { SignalLab, StrategyRow } from '../src/components/StrategyPanels.jsx'
import { render } from './helpers/render.jsx'

describe('SignalLab', () => {
  const signal = {
    tone: 'positive',
    action: '小仓跟踪',
    score: 64,
    confidence: 72,
    suggestedExposure: 0.45,
    breakdown: [
      { label: '趋势分', value: 70 },
      { label: '因子分', value: 58 },
    ],
    reasons: ['趋势分量偏强', '折溢价中性'],
    invalidationRules: ['跌破60日线降档', '折溢价超0.8%触发否决'],
  }
  const trendProfile = { state: '上行', drawdownFromHigh60: -0.03 }

  test('渲染动作、评分、趋势态、原因链与失效规则', () => {
    const { container, html, unmount } = render(
      <SignalLab signal={signal} trendProfile={trendProfile} riskBudget={30} />,
    )
    const out = html()
    expect(out).toContain('小仓跟踪')
    expect(out).toContain('上行')
    expect(out).toContain('风险预算 30%')
    expect(container.querySelector('.signal-score b').textContent).toBe('64')
    expect(container.querySelectorAll('.score-breakdown i')).toHaveLength(2)
    expect(container.querySelectorAll('.reason-chain p')).toHaveLength(2)
    expect(container.querySelectorAll('.rule-list span')).toHaveLength(2)
    expect(out).toContain('趋势分量偏强')
    expect(out).toContain('跌破60日线降档')
    unmount()
  })
})

describe('StrategyRow', () => {
  test('渲染策略名、规则、动作与全部指标项', () => {
    const strategy = {
      name: '趋势跟随',
      rule: '收盘价站上20/60日均线满仓',
      annualReturn: 0.182,
      maxDrawdown: -0.124,
      hitRate: 0.56,
      winLossRatio: 1.73,
      exposure: 0.62,
      emptyDays: 41,
      currentAction: '趋势持有',
    }
    const { container, html, unmount } = render(<StrategyRow strategy={strategy} />)
    const out = html()
    expect(out).toContain('趋势跟随')
    expect(out).toContain('收盘价站上20/60日均线满仓')
    expect(out).toContain('趋势持有')
    expect(out).toContain('41日')
    expect(container.querySelectorAll('dl > div')).toHaveLength(7)
    unmount()
  })
})
