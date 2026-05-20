import { SlidersHorizontal } from 'lucide-react'
import { formatPercent } from '../analysis/formatters.js'
import { buildCommandBandSummary } from '../analysis/commandBandSummary.js'

function describeRiskBudgetUse({ primaryDecision, riskBudget, signal }) {
  const budgetCap = Number.isFinite(riskBudget) ? riskBudget / 100 : null
  const signalExposure = signal.suggestedExposure
  const executionExposure = primaryDecision.exposure

  if (
    !Number.isFinite(budgetCap) ||
    !Number.isFinite(signalExposure) ||
    !Number.isFinite(executionExposure)
  ) {
    return '等待信号'
  }

  if (executionExposure >= budgetCap - 0.005) return '预算封顶'
  if (signalExposure >= budgetCap - 0.005) return '预算卡信号'
  if (executionExposure < signalExposure - 0.005) return `${primaryDecision.action}压仓`
  return '信号主导'
}

export function CommandBand({
  dailyChange,
  dataFreshness,
  premium,
  primaryDecision,
  riskBudget,
  signal,
  trendProfile,
  onRiskBudgetChange,
}) {
  const summary = buildCommandBandSummary({
    dailyChange,
    dataFreshness,
    premium,
    primaryDecision,
    signal,
    trendProfile,
  })
  const budgetUse = describeRiskBudgetUse({ primaryDecision, riskBudget, signal })

  return (
    <section className="command-band" aria-label="交易前检查">
      <div className={`command-action ${primaryDecision.tone}`}>
        <span className={`decision-dot ${primaryDecision.tone}`}></span>
        <div>
          <p>现在动作</p>
          <strong>{primaryDecision.action}</strong>
          <em>执行仓位 {formatPercent(primaryDecision.exposure, 0)}</em>
        </div>
      </div>
      <div className="command-insights">
        <div className="command-insight">
          <span>为什么</span>
          <strong>{summary.reason}</strong>
        </div>
        <div className="command-insight">
          <span>何时再看</span>
          <strong>{summary.nextStep}</strong>
        </div>
      </div>
      <label className="risk-slider command-risk">
        <div className="command-risk-top">
          <SlidersHorizontal size={18} />
          <span>风险预算上限</span>
          <b>{budgetUse}</b>
        </div>
        <div className="command-risk-metrics" aria-label="风险预算作用">
          <div>
            <span>上限</span>
            <strong>{riskBudget}%</strong>
          </div>
          <div>
            <span>信号建议</span>
            <strong>{formatPercent(signal.suggestedExposure, 0)}</strong>
          </div>
          <div>
            <span>最终执行</span>
            <strong>{formatPercent(primaryDecision.exposure, 0)}</strong>
          </div>
        </div>
        <input
          aria-label="风险预算上限"
          type="range"
          min="20"
          max="80"
          value={riskBudget}
          onChange={(event) => onRiskBudgetChange(Number(event.target.value))}
        />
      </label>
    </section>
  )
}
