import { Gauge, History } from 'lucide-react'
import { formatNumber, formatPercent, formatSignedPercent } from '../analysis/formatters.js'
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
  const surface = optimizer.parameterSurface

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
          <p>{best.overfitExplanation}</p>
        </div>
      </div>

      <div className="optimizer-stats">
        <div>
          <span>推荐仓位</span>
          <strong>{formatPercent(best.current.exposure, 0)}</strong>
        </div>
        <div>
          <span>稳定性</span>
          <strong>{best.stabilityBand}</strong>
          <p>{best.stabilityScore}分</p>
        </div>
        <div>
          <span>年化参考</span>
          <strong>{formatPercent(best.test.annualReturn, 1)}</strong>
          <p>样本外</p>
        </div>
        <div>
          <span>样本外回撤</span>
          <strong>{formatPercent(best.test.maxDrawdown, 1)}</strong>
          <p>越接近0越稳</p>
        </div>
      </div>

      <p className="optimizer-rule">{best.rule}</p>
      <p className="optimizer-rule">{best.explanation}</p>
      <p className="historical-caution">推荐策略从数百个网格候选里按样本外打分选出，展示的样本外年化与回撤带选择偏差、通常偏乐观；历史拟合不代表未来收益，优先看稳定性、回撤、仓位与过拟合风险。</p>

      {surface ? (
        <div className="surface-console">
          <div className="surface-head">
            <div>
              <span>稳定参数区间</span>
              <strong>{surface.stableZone?.label ?? '暂无稳定区间'}</strong>
              <p>{surface.stableZone?.explanation ?? surface.summary}</p>
            </div>
            <div>
              <span>稳健覆盖</span>
              <strong>{formatPercent(surface.stableCoverage, 0)}</strong>
              <p>{surface.stabilityBand}</p>
            </div>
          </div>
          <p className="surface-summary">{surface.summary}</p>
          <div className="surface-kpis">
            <div>
              <span>有效网格</span>
              <strong>{surface.validCount}/{surface.candidateCount}</strong>
              <p>通过样本外交易日门槛</p>
            </div>
            <div>
              <span>表面稳定</span>
              <strong>{surface.stabilityBand}</strong>
              <p>{surface.stabilityScore}分</p>
            </div>
            <div>
              <span>分数离散</span>
              <strong>{surface.dispersionLabel}</strong>
              <p>{formatNumber(surface.scoreDispersion, 1)}</p>
            </div>
          </div>
          {surface.recommended ? (
            <div className="surface-recommendation">
              <span>推荐配置</span>
              <strong>{surface.recommended.label}</strong>
              <p>
                {surface.recommended.explanation} 样本外年化参考{' '}
                {formatPercent(surface.recommended.testAnnualReturn, 1)}，回撤{' '}
                {formatPercent(surface.recommended.testMaxDrawdown, 1)}。
              </p>
            </div>
          ) : null}
          <div className="surface-window-list">
            {surface.topWindows.map((window, index) => (
              <div key={`${window.label}-${index}`}>
                <span>{window.label}</span>
                <strong>{window.stabilityBand}</strong>
                <p>{window.explanation}</p>
              </div>
            ))}
          </div>
          <div className="surface-warning-list">
            {surface.warnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        </div>
      ) : null}

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
        {optimizer.leaderboard.map((item, index) => (
          <article key={item.key ?? `${item.label}-${item.overfitRisk}-${item.testExposure}-${index}`}>
            <div>
              <strong>{item.label}</strong>
              <span>{item.stabilityBand} · 过拟合 {item.overfitRisk}</span>
              <p>{item.explanation}</p>
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
