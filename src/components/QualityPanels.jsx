import { Gauge } from 'lucide-react'
import { formatCnyAmount, formatPercent, formatSignedPercent } from '../analysis/metrics'
import { Meter } from './ui'

export function TradingQualityPanel({ quality }) {
  const { tracking, premium, liquidity } = quality

  return (
    <div className="quality-console">
      <div className={`quality-hero ${quality.tone}`}>
        <div>
          <span>执行结论</span>
          <strong>{quality.action}</strong>
          <p>{tracking.benchmarkName}</p>
        </div>
        <div className="quality-score">
          <Gauge size={18} />
          <b>{quality.score}</b>
        </div>
      </div>

      <div className="quality-kpis">
        <div>
          <span>60日跟踪差</span>
          <strong>{formatSignedPercent(tracking.deviation60, 2)}</strong>
          <p>{tracking.basis}口径</p>
        </div>
        <div>
          <span>折溢价温度</span>
          <strong>{premium.status}</strong>
          <p>{formatSignedPercent(premium.currentPremium, 2)} · {formatZScore(premium.zScore)}</p>
        </div>
        <div>
          <span>成交额分位</span>
          <strong>{formatPercentile(liquidity.amountPercentile)}</strong>
          <p>{formatCnyAmount(liquidity.latestAmount)}</p>
        </div>
      </div>

      <div className="quality-bars">
        <Meter label="跟踪" value={tracking.score} color="#526f8d" />
        <Meter label="折溢价" value={premium.score} color="#b96836" />
        <Meter label="流动性" value={liquidity.score} color="#5f7f56" />
      </div>

      <dl className="quality-detail-list">
        <div>
          <dt>60日跟踪误差</dt>
          <dd>{formatPercent(tracking.trackingError60, 1)}</dd>
        </div>
        <div>
          <dt>20日折溢价均值</dt>
          <dd>{formatSignedPercent(premium.average20, 2)}</dd>
        </div>
        <div>
          <dt>成交/20日均额</dt>
          <dd>{formatRatio(liquidity.amountRatio20)}</dd>
        </div>
        <div>
          <dt>换手率</dt>
          <dd>{formatPercent(liquidity.turnoverRate, 2)}</dd>
        </div>
      </dl>

      <div className="quality-watchlist">
        {quality.watchPoints.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </div>
    </div>
  )
}

function formatZScore(value) {
  if (!Number.isFinite(value)) return '暂无'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}σ`
}

function formatPercentile(value) {
  if (!Number.isFinite(value)) return '暂无'
  return `${value}分位`
}

function formatRatio(value) {
  if (!Number.isFinite(value)) return '暂无'
  return `${value.toFixed(2)}x`
}
