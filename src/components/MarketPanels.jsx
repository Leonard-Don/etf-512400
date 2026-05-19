import { useMemo, useState } from 'react'
import { formatNumber, formatPercent, formatSignedPercent } from '../analysis/formatters.js'
import { Meter } from './ui'

export function MiniLineChart({ trendSeries }) {
  const [activeIndex, setActiveIndex] = useState(null)
  const chart = useMemo(() => buildIndexedChart(trendSeries, CHART_KEYS), [trendSeries])
  const activePoint = activeIndex === null ? null : chart.points[activeIndex] ?? null
  const summary = chart.series.map((series) => ({
    ...series,
    change: Number.isFinite(series.latest?.value) ? (series.latest.value - 100) / 100 : null,
  }))

  function handlePointerMove(event) {
    if (chart.points.length <= 1) return
    const rect = event.currentTarget.getBoundingClientRect()
    const svgX = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH
    const ratio = (svgX - CHART_MARGIN.left) / chart.plotWidth
    const nextIndex = Math.max(0, Math.min(chart.points.length - 1, Math.round(ratio * (chart.points.length - 1))))
    setActiveIndex(nextIndex)
  }

  return (
    <div className="line-chart">
      <svg
        className="indexed-chart"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="ETF与因子走势"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <title>ETF与因子走势（共同样本期）</title>
        <defs>
          <linearGradient id="indexedChartSurface" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f3f7f4" />
          </linearGradient>
        </defs>
        <rect
          className="chart-surface"
          x={CHART_MARGIN.left}
          y={CHART_MARGIN.top}
          width={chart.plotWidth}
          height={chart.plotHeight}
          rx="8"
        />
        <g className="chart-grid">
          {chart.ticks.map((tick) => (
            <g key={tick.value}>
              <line x1={CHART_MARGIN.left} x2={CHART_MARGIN.left + chart.plotWidth} y1={tick.y} y2={tick.y} />
              <text x={CHART_MARGIN.left - 10} y={tick.y + 4} textAnchor="end">
                {formatIndexTick(tick.value)}
              </text>
            </g>
          ))}
          <line
            className="chart-baseline"
            x1={CHART_MARGIN.left}
            x2={CHART_MARGIN.left + chart.plotWidth}
            y1={chart.yFor(100)}
            y2={chart.yFor(100)}
          />
          <text className="chart-baseline-label" x={CHART_MARGIN.left + 8} y={chart.yFor(100) - 7}>
            基准 100
          </text>
        </g>
        <g className="chart-x-axis">
          {chart.xLabels.map((label) => (
            <text key={`${label.date}-${label.x}`} x={label.x} y={CHART_HEIGHT - 13} textAnchor={label.anchor}>
              {label.date}
            </text>
          ))}
        </g>
        {chart.series.map((item) => (
          <polyline
            fill="none"
            key={item.key}
            points={item.points}
            stroke={item.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={item.key === 'etf' ? 3.2 : 2.2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <g className="chart-end-labels">
          {summary.map((item) => (
            item.latest ? (
              <g key={item.key} transform={`translate(${item.latest.x + 10} ${item.latest.y})`}>
                <circle cx="-4" cy="0" r="3.2" fill={item.color} />
                <text fill={item.color}>{item.label}</text>
                <text className="chart-end-change" x="0" y="14" fill={item.color}>
                  {formatSignedPercent(item.change, 1)}
                </text>
              </g>
            ) : null
          ))}
        </g>
        {activePoint ? (
          <ChartTooltip activePoint={activePoint} chart={chart} keys={CHART_KEYS} />
        ) : null}
      </svg>
      <div className="chart-legend">
        {summary.map((item) => (
          <span key={item.key} title={`${item.label} 较起点 ${formatSignedPercent(item.change, 1)}`}>
            <i style={{ backgroundColor: item.color }}></i>
            {item.label}
            <b>{formatSignedPercent(item.change, 1)}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

const CHART_WIDTH = 720
const CHART_HEIGHT = 260
const CHART_MARGIN = {
  top: 22,
  right: 112,
  bottom: 38,
  left: 48,
}
const CHART_KEYS = [
  { key: 'etf', label: 'ETF', color: '#111827' },
  { key: 'gold', label: '黄金', color: '#c58a2c' },
  { key: 'copper', label: '铜', color: '#b96836' },
  { key: 'rareEarth', label: '稀土', color: '#5f7f56' },
]

function buildIndexedChart(series, keys) {
  const safeSeries = Array.isArray(series) ? series : []
  const comparableSeries = safeSeries.filter((point) =>
    keys.every((item) => Number.isFinite(point?.[item.key])),
  )
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom
  const baselines = Object.fromEntries(
    keys.map((item) => [
      item.key,
      comparableSeries[0]?.[item.key] ?? null,
    ]),
  )
  const points = comparableSeries.map((point, index) => {
    const normalized = {
      date: point?.date ?? '',
      index,
    }
    keys.forEach((item) => {
      const value = point?.[item.key]
      const baseline = baselines[item.key]
      normalized[item.key] = Number.isFinite(value) && Number.isFinite(baseline) && baseline !== 0
        ? (value / baseline) * 100
        : null
    })
    return normalized
  })
  const values = points.flatMap((point) => keys.map((item) => point[item.key])).filter(Number.isFinite)
  const rawMin = values.length ? Math.min(100, ...values) : 92
  const rawMax = values.length ? Math.max(100, ...values) : 108
  const padding = Math.max((rawMax - rawMin) * 0.12, 2)
  const min = floorToStep(rawMin - padding, 5)
  const max = ceilToStep(rawMax + padding, 5)
  const span = max - min || 1
  const xFor = (index) => CHART_MARGIN.left + (plotWidth * index) / Math.max(points.length - 1, 1)
  const yFor = (value) => CHART_MARGIN.top + ((max - value) / span) * plotHeight

  const seriesLines = keys.map((item) => {
    const renderedPoints = points
      .map((point, index) => {
        const value = point[item.key]
        if (!Number.isFinite(value)) return null
        return {
          x: xFor(index),
          y: yFor(value),
          value,
        }
      })
      .filter(Boolean)
    return {
      ...item,
      points: renderedPoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '),
      latest: renderedPoints.at(-1) ?? null,
    }
  })
  const tickValues = [max, max - span * 0.25, 100, min + span * 0.25, min]
  const ticks = uniqueRounded(tickValues)
    .filter((value) => value >= min && value <= max)
    .map((value) => ({ value, y: yFor(value) }))
  const xLabels = buildXAxisLabels(points, xFor)

  return {
    points,
    plotWidth,
    plotHeight,
    series: seriesLines,
    ticks,
    xLabels,
    yFor,
  }
}

function ChartTooltip({ activePoint, chart, keys }) {
  const activeX = CHART_MARGIN.left + (chart.plotWidth * activePoint.index) / Math.max(chart.points.length - 1, 1)
  const tooltipWidth = 166
  const tooltipX = Math.max(
    CHART_MARGIN.left + 8,
    Math.min(activeX + 14, CHART_WIDTH - CHART_MARGIN.right - tooltipWidth + 48),
  )
  const tooltipY = CHART_MARGIN.top + 12
  const rows = keys.map((item) => ({
    ...item,
    value: activePoint[item.key],
  }))

  return (
    <g className="chart-tooltip">
      <line x1={activeX} x2={activeX} y1={CHART_MARGIN.top} y2={CHART_HEIGHT - CHART_MARGIN.bottom} />
      <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height="112" rx="8" />
      <text className="chart-tooltip-date" x={tooltipX + 12} y={tooltipY + 22}>
        {activePoint.date || '当前窗口'}
      </text>
      {rows.map((item, index) => (
        <g key={item.key} transform={`translate(${tooltipX + 12} ${tooltipY + 43 + index * 16})`}>
          <circle cx="0" cy="-4" r="3" fill={item.color} />
          <text x="10" y="0">{item.label}</text>
          <text x="142" y="0" textAnchor="end">
            {formatSignedPercent(Number.isFinite(item.value) ? (item.value - 100) / 100 : null, 1)}
          </text>
        </g>
      ))}
    </g>
  )
}

function buildXAxisLabels(points, xFor) {
  if (!points.length) return []
  const candidates = [
    { index: 0, anchor: 'start' },
    { index: Math.floor((points.length - 1) / 2), anchor: 'middle' },
    { index: points.length - 1, anchor: 'end' },
  ]
  const seen = new Set()
  return candidates
    .filter(({ index }) => {
      if (seen.has(index)) return false
      seen.add(index)
      return true
    })
    .map(({ index, anchor }) => ({
      anchor,
      date: points[index]?.date ?? '',
      x: xFor(index),
    }))
}

function uniqueRounded(values) {
  const seen = new Set()
  return values.reduce((acc, value) => {
    const rounded = Number(value.toFixed(1))
    if (!seen.has(rounded)) {
      seen.add(rounded)
      acc.push(rounded)
    }
    return acc
  }, [])
}

function floorToStep(value, step) {
  return Math.floor(value / step) * step
}

function ceilToStep(value, step) {
  return Math.ceil(value / step) * step
}

function formatIndexTick(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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
  // 条形宽度做 finite 守卫避免 NaN/undefined 漏到 CSS，且把越界但有限的值
  // （拥挤度漂到负数或 >100、压力情景里的极端回撤/VaR）夹到 [0, 100]，
  // 避免负宽度或撑破容器；strong 文案仍走 formatter 输出原始数字（合法 0
  // 仍渲染 0%）。
  const { maxDrawdown, oneDayVar95, crowdingScore } = riskMetrics
  const clampWidth = (n) => Math.max(0, Math.min(n, 100))
  const drawdownWidth = Number.isFinite(maxDrawdown)
    ? clampWidth(Math.abs(maxDrawdown) * 200)
    : 0
  const varWidth = Number.isFinite(oneDayVar95)
    ? clampWidth(Math.abs(oneDayVar95) * 1000)
    : 0
  const crowdingFinite = Number.isFinite(crowdingScore)
  const items = [
    { label: '最大回撤', value: maxDrawdown, width: drawdownWidth },
    { label: '单日VaR', value: oneDayVar95, width: varWidth },
    {
      label: '拥挤度',
      value: crowdingFinite ? crowdingScore / 100 : crowdingScore,
      width: crowdingFinite ? clampWidth(crowdingScore) : 0,
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
          {driver.international ? (
            <div className="driver-international" aria-label={`${driver.label}国际参照`}>
              <div className="driver-international-main">
                <span>国际参照</span>
                <strong>{driver.international.label}</strong>
                <small>{driver.international.source} · {driver.international.unit}</small>
              </div>
              <div className="driver-international-price">
                <strong>{formatDriverPrice(driver.international)}</strong>
                <span className={getChangeTone(driver.international.changePercent)}>
                  {formatSignedPercent(driver.international.changePercent)}
                </span>
              </div>
              <dl className="driver-international-compare">
                <div>
                  <dt>内盘日涨跌</dt>
                  <dd>{formatSignedPercent(driver.changePercent, 1)}</dd>
                </div>
                <div>
                  <dt>外盘日涨跌</dt>
                  <dd>{formatSignedPercent(driver.international.changePercent, 1)}</dd>
                </div>
                <div>
                  <dt>内外联动</dt>
                  <dd>{describeDriverLinkage(driver.changePercent, driver.international.changePercent)}</dd>
                </div>
              </dl>
            </div>
          ) : null}
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

function getChangeTone(value) {
  if (!Number.isFinite(value)) return 'neutral'
  return value >= 0 ? 'positive' : 'negative'
}

function describeDriverLinkage(localChange, internationalChange) {
  if (!Number.isFinite(localChange) || !Number.isFinite(internationalChange)) return '暂无'
  if (localChange === 0 || internationalChange === 0) return '中性'
  return Math.sign(localChange) === Math.sign(internationalChange) ? '同向' : '背离'
}
