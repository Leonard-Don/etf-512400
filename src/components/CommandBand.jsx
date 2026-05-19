import { SlidersHorizontal } from 'lucide-react'
import { formatPercent } from '../analysis/formatters.js'
import { buildCommandBandSummary } from '../analysis/commandBandSummary.js'

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
          <span>风险预算 {riskBudget}%</span>
          <b>信号仓 {formatPercent(signal.suggestedExposure, 0)}</b>
        </div>
        <input
          aria-label="风险预算"
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
