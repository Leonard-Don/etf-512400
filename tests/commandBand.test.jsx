import { describe, expect, test } from 'vitest'
import { buildCommandBandSummary } from '../src/analysis/commandBandSummary.js'
import { CommandBand } from '../src/components/CommandBand.jsx'
import { render } from './helpers/render.jsx'

const baseSignal = {
  action: '禁止追高',
  score: 49,
  suggestedExposure: 0.1,
  reasons: ['趋势状态：震荡观察，20日+1.0%，60日-5.0%'],
  factorProfile: {
    highRiskFactors: 3,
  },
}

const baseDecision = {
  action: '禁止追高',
  exposure: 0.1,
  tone: 'warning',
}

describe('CommandBand summary', () => {
  test('prioritizes actionable hard blockers over generic signal text', () => {
    const summary = buildCommandBandSummary({
      dailyChange: 0.01,
      dataFreshness: { tone: 'good', summary: '数据新鲜' },
      premium: 0,
      primaryDecision: baseDecision,
      signal: baseSignal,
      trendProfile: { state: '震荡观察' },
    })

    expect(summary.reason).toContain('高风险因子 3 个')
    expect(summary.nextStep).toContain('高风险因子≤2')
  })
})

describe('CommandBand render', () => {
  test('shows action, blocker, next step and risk-budget effect in one strip', () => {
    const { html, unmount } = render(
      <CommandBand
        dailyChange={0.01}
        dataFreshness={{ tone: 'good', summary: '数据新鲜' }}
        premium={0}
        primaryDecision={baseDecision}
        riskBudget={48}
        signal={baseSignal}
        trendProfile={{ state: '震荡观察' }}
        onRiskBudgetChange={() => {}}
      />,
    )
    const out = html()

    expect(out).toContain('现在动作')
    expect(out).toContain('执行仓位 10%')
    expect(out).toContain('为什么')
    expect(out).toContain('高风险因子 3 个')
    expect(out).toContain('何时再看')
    expect(out).toContain('风险预算 48%')
    expect(out).toContain('信号仓 10%')
    unmount()
  })
})
