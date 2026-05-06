import { formatPercent, formatSignedPercent } from '../analysis/metrics'

export function DecisionDeck({
  dailyChange,
  premium,
  primaryDecision,
  signal,
  topRiskDrivers,
  trendProfile,
}) {
  return (
    <section className="decision-deck" aria-label="今日决策台">
      <article className={`today-card primary ${primaryDecision.tone}`}>
        <div className="today-card-title">
          <span>今日决策台</span>
          <strong>{primaryDecision.source}</strong>
        </div>
        <div className="primary-decision">
          <div>
            <p>主动作</p>
            <h2>{primaryDecision.action}</h2>
          </div>
          <div className="primary-exposure">
            <span>主仓位</span>
            <b>{formatPercent(primaryDecision.exposure, 0)}</b>
          </div>
        </div>
        <div className="primary-rule">
          <span>{primaryDecision.rule}</span>
          <em>信号建议 {formatPercent(signal.suggestedExposure, 0)} · {signal.action}</em>
        </div>
      </article>

      <article className="today-card risk">
        <div className="today-card-title">
          <span>核心风险</span>
          <strong>先看风险</strong>
        </div>
        <div className="risk-brief">
          <BriefItem label="趋势" value={trendProfile.state} />
          <BriefItem label="60日回撤" value={formatSignedPercent(trendProfile.drawdownFromHigh60, 1)} />
          <BriefItem label="高风险因子" value={`${signal.factorProfile.highRiskFactors}个`} />
          <BriefItem label="过拟合" value={primaryDecision.overfitRisk} />
        </div>
        <p className="decision-note">
          历史优化只作规则参考，主看仓位、回撤、稳定性和失效条件。
        </p>
      </article>

      <article className="today-card drivers">
        <div className="today-card-title">
          <span>商品驱动</span>
          <strong>风险排序</strong>
        </div>
        <div className="driver-brief-list">
          {topRiskDrivers.map((driver) => (
            <div key={driver.key}>
              <span>{driver.label}</span>
              <strong>{driver.riskScore}</strong>
              <em>{formatSignedPercent(driver.return20, 1)}</em>
            </div>
          ))}
        </div>
        <div className="market-brief">
          <span>ETF {formatSignedPercent(dailyChange, 2)}</span>
          <span>折溢价 {formatSignedPercent(premium, 2)}</span>
          <span>稳定 {primaryDecision.stabilityScore}</span>
        </div>
      </article>
    </section>
  )
}

function BriefItem({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
