import { Gauge } from 'lucide-react'
import { formatCnyAmount, formatPercent, formatSignedPercent } from '../analysis/formatters.js'
import { Meter } from './ui'

export function TradingQualityPanel({ quality }) {
  const { tracking, premium, liquidity } = quality
  const heroCopy = buildQualityHeroCopy(quality)

  return (
    <div className="quality-console">
      <div className={`quality-hero ${quality.tone}`}>
        <div className="quality-hero-main">
          <span>交易前检查</span>
          <strong>{quality.action}</strong>
          <p>{heroCopy.reason}</p>
          <div className="quality-hero-steps">
            <em>{heroCopy.check}</em>
            <em>{tracking.benchmarkName}</em>
          </div>
        </div>
        <div className="quality-score">
          <Gauge size={18} />
          <span>质量分</span>
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
        <QualityMeter
          label="跟踪"
          value={tracking.score}
          color="#526f8d"
          status={tracking.status}
          detail={formatTrackingMeterDetail(tracking)}
        />
        <QualityMeter
          label="折溢价"
          value={premium.score}
          color="#b96836"
          status={premium.status}
          detail={formatPremiumMeterDetail(premium)}
        />
        <QualityMeter
          label="流动性"
          value={liquidity.score}
          color="#5f7f56"
          status={liquidity.status}
          detail={formatLiquidityMeterDetail(liquidity)}
        />
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

function buildQualityHeroCopy({ action, tracking, premium, liquidity }) {
  if (tracking.status === '偏离放大') {
    return {
      reason: `近60日相对基准偏离偏大：${formatSignedPercent(tracking.deviation60, 2)}，先确认不是跟踪误差或口径问题。`,
      check: `先看${tracking.basis}口径、跟踪误差和基准走势`,
    }
  }

  if (premium.status === '溢价偏热') {
    return {
      reason: `当前折溢价偏热：${formatSignedPercent(premium.currentPremium, 2)}，追买容易把短线溢价变成持仓成本。`,
      check: '优先限价，等折溢价回落再放大仓位',
    }
  }

  if (liquidity.status === '成交收缩') {
    return {
      reason: `成交额处于低位：${formatPercentile(liquidity.amountPercentile)}，大单可能放大滑点。`,
      check: '拆单执行，避开临近收盘一次性成交',
    }
  }

  return {
    reason: `${action}：跟踪、折溢价和流动性没有触发硬性拦截。`,
    check: '按主仓位执行，继续用限价控制成本',
  }
}

function QualityMeter({ label, value, color, status, detail }) {
  return (
    <div className="quality-meter-row">
      <Meter label={label} value={value} color={color} />
      <p className="quality-meter-detail">
        <strong>{status}</strong>
        <span>{detail}</span>
      </p>
    </div>
  )
}

function formatTrackingMeterDetail(tracking) {
  if (tracking.status === '样本不足') return `样本 ${tracking.sampleSize} 日`
  return `60日 ${formatSignedPercent(tracking.deviation60, 2)} · 误差 ${formatPercent(tracking.trackingError60, 1)}`
}

function formatPremiumMeterDetail(premium) {
  if (premium.status === '样本不足') return `样本 ${premium.sampleSize} 日`
  return `当前 ${formatSignedPercent(premium.currentPremium, 2)} · ${formatZScore(premium.zScore)}`
}

function formatLiquidityMeterDetail(liquidity) {
  if (liquidity.status === '样本不足') return `样本 ${liquidity.sampleSize} 日`
  return `${formatPercentile(liquidity.amountPercentile)} · ${formatRatio(liquidity.amountRatio20)}`
}

export function DataFreshnessDrilldown({ registry }) {
  const providers = registry?.providers ?? []
  if (!providers.length) return null

  const groups = registry.groups ?? {}

  return (
    <div className="provider-freshness-card" aria-label="数据源新鲜度明细">
      <div className="provider-freshness-head">
        <div>
          <span>数据源新鲜度</span>
          <strong>{registry.summary}</strong>
        </div>
        <b>{registry.stalenessBadge}</b>
      </div>

      <div className="provider-group-grid">
        <ProviderGroup label="核心源" group={groups.core} />
        <ProviderGroup label="辅助源" group={groups.auxiliary} />
        <ProviderGroup label="缓存源" group={groups.cache} />
        <ProviderGroup label="失败源" group={groups.failed} />
      </div>

      <div className="provider-action-list">
        {(registry.actionItems ?? []).map((item) => (
          <p key={item}>{item}</p>
        ))}
      </div>

      <div className="provider-source-list">
        {providers.map((source) => (
          <article
            className={`provider-source-row ${
              source.ok ? (source.fallback ? 'warning' : 'ok') : source.required ? 'danger' : 'warning'
            }`}
            key={source.id}
          >
            <div>
              <span>{source.roleLabel}</span>
              <strong>{source.label}</strong>
              <p>{source.statusText} · {source.ageText}</p>
            </div>
            <div className="provider-source-badges">
              <b>{source.badge}</b>
              <em>{source.coveragePercent}%覆盖</em>
            </div>
            <p className="provider-next-action">{source.nextAction}</p>
            {source.fallbackReason ? (
              <p className="provider-fallback-reason">{source.fallbackReason}</p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  )
}

function ProviderGroup({ label, group }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{group?.count ?? 0}个</strong>
      <p>{group?.labels ?? '无'}</p>
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
