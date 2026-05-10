import { formatNumber, formatPercent, formatSignedPercent, mapSeriesToPolyline } from '../analysis/metrics'
import { Meter } from './ui'

export function MiniLineChart({ trendSeries }) {
  const keys = [
    { key: 'etf', label: 'ETF', color: '#111827' },
    { key: 'gold', label: '黄金', color: '#c58a2c' },
    { key: 'copper', label: '铜', color: '#b96836' },
    { key: 'rareEarth', label: '稀土', color: '#5f7f56' },
  ]

  return (
    <div className="line-chart">
      <svg viewBox="0 0 520 170" role="img" aria-label="ETF与因子走势">
        <g className="chart-grid">
          <line x1="0" x2="520" y1="24" y2="24" />
          <line x1="0" x2="520" y1="82" y2="82" />
          <line x1="0" x2="520" y1="140" y2="140" />
        </g>
        {keys.map((item) => (
          <polyline
            fill="none"
            key={item.key}
            points={mapSeriesToPolyline(trendSeries, item.key, 520, 140)}
            stroke={item.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={item.key === 'etf' ? 3.2 : 2.2}
            transform="translate(0 12)"
          />
        ))}
      </svg>
      <div className="chart-legend">
        {keys.map((item) => (
          <span key={item.key}>
            <i style={{ backgroundColor: item.color }}></i>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function FactorTile({ factor }) {
  return (
    <article className="factor-tile">
      <div className="factor-top">
        <span style={{ background: factor.color }}></span>
        <strong>{factor.name}</strong>
        <em>{factor.weight.toFixed(2)}%</em>
      </div>
      <div className="factor-bars">
        <Meter label="趋势" value={factor.trend} color={factor.color} />
        <Meter label="风险" value={factor.risk} color="#7c3f3b" />
      </div>
      <p>{factor.detail}</p>
    </article>
  )
}

export function RiskStack({ riskMetrics }) {
  // 标度：回撤 50% → 满格；单日 VaR 10% → 满格
  // 缺失指标（null/undefined/NaN）让 formatPercent 走 暂无 fallback；
  // 条形宽度做 finite 守卫避免 NaN/undefined 漏到 CSS（合法 0 仍渲染 0%）。
  const { maxDrawdown, oneDayVar95, crowdingScore } = riskMetrics
  const drawdownWidth = Number.isFinite(maxDrawdown)
    ? Math.min(Math.abs(maxDrawdown) * 200, 100)
    : 0
  const varWidth = Number.isFinite(oneDayVar95)
    ? Math.min(Math.abs(oneDayVar95) * 1000, 100)
    : 0
  const crowdingFinite = Number.isFinite(crowdingScore)
  const items = [
    { label: '最大回撤', value: maxDrawdown, width: drawdownWidth },
    { label: '单日VaR', value: oneDayVar95, width: varWidth },
    {
      label: '拥挤度',
      value: crowdingFinite ? crowdingScore / 100 : crowdingScore,
      width: crowdingFinite ? crowdingScore : 0,
    },
  ]

  return (
    <div className="risk-stack">
      {items.map((item) => (
        <div className="risk-row" key={item.label}>
          <span>{item.label}</span>
          <div>
            <i style={{ width: `${item.width}%` }}></i>
          </div>
          <strong>{formatPercent(item.value)}</strong>
        </div>
      ))}
    </div>
  )
}

export function CommodityDriverPanel({ commodityDrivers }) {
  return (
    <div className="driver-list">
      {commodityDrivers.map((driver) => (
        <article className="driver-row" key={driver.key}>
          <div className="driver-main">
            <strong>{driver.label}</strong>
            <span>{driver.source} · {driver.unit}</span>
          </div>
          <div className="driver-price">
            <strong>{formatDriverPrice(driver)}</strong>
            <span className={Number.isFinite(driver.changePercent) ? (driver.changePercent >= 0 ? 'positive' : 'negative') : 'neutral'}>
              {formatSignedPercent(driver.changePercent)}
            </span>
          </div>
          <div className="driver-scores">
            <Meter label="趋势" value={driver.trendScore} color="#5f7f56" />
            <Meter label="风险" value={driver.riskScore} color="#7c3f3b" />
          </div>
          <dl>
            <div>
              <dt>5日</dt>
              <dd>{formatSignedPercent(driver.return5, 1)}</dd>
            </div>
            <div>
              <dt>20日</dt>
              <dd>{formatSignedPercent(driver.return20, 1)}</dd>
            </div>
            <div>
              <dt>60日</dt>
              <dd>{formatSignedPercent(driver.return60, 1)}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  )
}

function formatDriverPrice(driver) {
  if (!Number.isFinite(driver.price)) return '暂无'
  const digits = driver.price >= 10000 ? 0 : 2
  return formatNumber(driver.price, digits)
}
