import { Gauge, History } from 'lucide-react'
import { formatNumber, formatPercent, formatSignedPercent } from '../analysis/metrics'
import { Meter } from './ui'

export function SignalLab({ signal, trendProfile, riskBudget }) {
  return (
    <div className="signal-lab">
      <div className={`signal-hero ${signal.tone}`}>
        <div>
          <span>系统信号</span>
          <strong>{signal.action}</strong>
          <p>建议仓位 {formatPercent(signal.suggestedExposure, 0)} · 风险预算 {riskBudget}%</p>
        </div>
        <div className="signal-score">
          <Gauge size={18} />
          <b>{signal.score}</b>
        </div>
      </div>

      <div className="signal-kpis">
        <div>
          <span>趋势</span>
          <strong>{trendProfile.state}</strong>
        </div>
        <div>
          <span>置信</span>
          <strong>{signal.confidence}</strong>
        </div>
        <div>
          <span>60日回撤</span>
          <strong>{formatSignedPercent(trendProfile.drawdownFromHigh60, 1)}</strong>
        </div>
      </div>

      <div className="score-breakdown">
        {signal.breakdown.map((item) => (
          <Meter key={item.label} label={item.label} value={item.value} color="#5f7f56" />
        ))}
      </div>

      <div className="reason-chain">
        <div className="mini-title">
          <History size={16} />
          <strong>原因链</strong>
        </div>
        {signal.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
      </div>

      <div className="rule-list">
        {signal.invalidationRules.map((rule) => (
          <span key={rule}>{rule}</span>
        ))}
      </div>
    </div>
  )
}

export function StrategyOptimizer({ optimizer }) {
  if (!optimizer.ok) {
    return <p className="empty-state">{optimizer.reason}</p>
  }

  const best = optimizer.best

  return (
    <div className="optimizer-console">
      <div className={`optimizer-hero ${best.current.tone}`}>
        <div>
          <span>推荐策略</span>
          <strong>{best.current.action}</strong>
          <p>{best.label}</p>
        </div>
        <div className="optimizer-risk">
          <span>过拟合</span>
          <b>{best.overfitRisk}</b>
        </div>
      </div>

      <div className="optimizer-stats">
        <div>
          <span>推荐仓位</span>
          <strong>{formatPercent(best.current.exposure, 0)}</strong>
        </div>
        <div>
          <span>稳定性</span>
          <strong>{best.stabilityScore}</strong>
        </div>
        <div>
          <span>年化参考</span>
          <strong>{formatPercent(best.test.annualReturn, 1)}</strong>
        </div>
        <div>
          <span>样本外回撤</span>
          <strong>{formatPercent(best.test.maxDrawdown, 1)}</strong>
        </div>
      </div>

      <p className="optimizer-rule">{best.rule}</p>
      <p className="historical-caution">历史拟合结果不代表未来收益，优先看稳定性、回撤、仓位和过拟合风险。</p>

      <div className="optimizer-split">
        <div>
          <span>样本内</span>
          <strong>{optimizer.sample.train}日</strong>
          <p>年化参考 {formatPercent(best.train.annualReturn, 1)} · 回撤 {formatPercent(best.train.maxDrawdown, 1)}</p>
        </div>
        <div>
          <span>样本外</span>
          <strong>{optimizer.sample.test}日</strong>
          <p>胜率 {formatPercent(best.test.hitRate, 0)} · 仓位 {formatPercent(best.test.exposure, 0)}</p>
        </div>
      </div>

      <div className="factor-overlay-note">{best.current.factorNote}</div>

      <div className="optimizer-list">
        {optimizer.leaderboard.map((item) => (
          <article key={item.label}>
            <div>
              <strong>{item.label}</strong>
              <span>稳健 {item.stabilityScore} · 过拟合 {item.overfitRisk}</span>
            </div>
            <dl>
              <div>
                <dt>年化参考</dt>
                <dd>{formatPercent(item.testAnnualReturn, 1)}</dd>
              </div>
              <div>
                <dt>回撤</dt>
                <dd>{formatPercent(item.testMaxDrawdown, 1)}</dd>
              </div>
              <div>
                <dt>仓位</dt>
                <dd>{formatPercent(item.testExposure, 0)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <div className="rule-list">
        {best.invalidationRules.map((rule) => (
          <span key={rule}>{rule}</span>
        ))}
      </div>
    </div>
  )
}

export function StrategyRow({ strategy }) {
  return (
    <article className="strategy-row">
      <div>
        <strong>{strategy.name}</strong>
        <p>{strategy.rule}</p>
      </div>
      <dl>
        <div>
          <dt>年化参考</dt>
          <dd>{formatPercent(strategy.annualReturn, 1)}</dd>
        </div>
        <div>
          <dt>回撤</dt>
          <dd>{formatPercent(strategy.maxDrawdown, 1)}</dd>
        </div>
        <div>
          <dt>胜率</dt>
          <dd>{formatPercent(strategy.hitRate, 0)}</dd>
        </div>
        <div>
          <dt>盈亏比</dt>
          <dd>{formatNumber(strategy.winLossRatio, 2)}</dd>
        </div>
        <div>
          <dt>仓位</dt>
          <dd>{formatPercent(strategy.exposure, 0)}</dd>
        </div>
        <div>
          <dt>空仓</dt>
          <dd>{strategy.emptyDays}日</dd>
        </div>
        <div>
          <dt>动作</dt>
          <dd>{strategy.currentAction}</dd>
        </div>
      </dl>
    </article>
  )
}
