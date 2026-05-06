import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronsUpDown,
  Database,
  FlaskConical,
  Gauge,
  GitBranch,
  Info,
  Layers3,
  LineChart,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  TrendingUp,
} from 'lucide-react'
import {
  dataSources,
  etfProfile,
  eventLog,
  etfKlines,
  benchmarkKlines,
  factorBaskets,
  holdings,
  commodityDrivers,
  navSeries,
  riskMetrics,
  snapshotHistory,
  trendSeries,
} from './data/etf512400'
import {
  buildBacktestStrategies,
  buildSignalEngine,
  buildStrategyOptimizer,
  buildTradingQualityProfile,
  buildTrendProfile,
  calculateDailyChange,
  calculatePremium,
  composePrimaryDecision,
  buildDataFreshness,
  describeMarketStatus,
  formatCnyAmount,
  formatNumber,
  formatPercent,
  formatSnapshotTime,
  formatSignedPercent,
  getScenarioAdjustment,
  groupHoldingsByBasket,
  LOCAL_REALTIME_KLINE_URL,
  LOCAL_REALTIME_QUOTE_URL,
  LOCAL_REALTIME_TENCENT_URL,
  parseRealtimeKline,
  parseRealtimeQuote,
  parseRealtimeTencent,
  REALTIME_KLINE_URL,
  REALTIME_QUOTE_URL,
  REALTIME_TENCENT_URL,
  sumWeights,
} from './analysis/metrics'
import { DecisionDeck } from './components/DecisionDeck'
import { HoldingsTable } from './components/HoldingsTable'
import { CommodityDriverPanel, FactorTile, MiniLineChart, RiskStack } from './components/MarketPanels'
import { TradingQualityPanel } from './components/QualityPanels'
import { SignalLab, StrategyOptimizer, StrategyRow } from './components/StrategyPanels'
import { MetricCard, Panel } from './components/ui'
import './App.css'

const timeframes = ['20日', '60日', '年初至今']
const scenarios = [
  { id: 'base', label: '基准' },
  { id: 'goldRisk', label: '黄金避险' },
  { id: 'dollarUp', label: '美元利率' },
  { id: 'demandSoft', label: '需求走弱' },
]
const REALTIME_REFRESH_MS = 30000
const REALTIME_TIMEOUT_MS = 8000
const realtimeEndpoints = [
  {
    id: 'local-quote',
    label: '本地盘口实时',
    url: LOCAL_REALTIME_QUOTE_URL,
    parse: parseRealtimeQuote,
  },
  {
    id: 'local-kline',
    label: '本地K线实时',
    url: LOCAL_REALTIME_KLINE_URL,
    parse: parseRealtimeKline,
  },
  {
    id: 'local-tencent',
    label: '本地腾讯实时',
    url: LOCAL_REALTIME_TENCENT_URL,
    parse: parseRealtimeTencent,
  },
  {
    id: 'quote',
    label: '盘口实时',
    url: REALTIME_QUOTE_URL,
    parse: parseRealtimeQuote,
  },
  {
    id: 'kline',
    label: '当日K线实时',
    url: REALTIME_KLINE_URL,
    parse: parseRealtimeKline,
  },
  {
    id: 'tencent',
    label: '腾讯实时',
    url: REALTIME_TENCENT_URL,
    parse: parseRealtimeTencent,
  },
]

function App() {
  const [timeframe, setTimeframe] = useState('60日')
  const [scenario, setScenario] = useState('base')
  const [riskBudget, setRiskBudget] = useState(48)
  const [refreshNote, setRefreshNote] = useState('')
  const [realtimeState, setRealtimeState] = useState({
    status: 'idle',
    quote: null,
    lastUpdated: null,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    let timer = null

    async function fetchRealtimeEndpoint(endpoint) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REALTIME_TIMEOUT_MS)

      try {
        const response = await fetch(endpoint.url, {
          headers: { Accept: 'application/json,*/*' },
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`${endpoint.label}请求失败 ${response.status}`)
        }
        const fetchedAt = new Date()
        return {
          quote: {
            ...endpoint.parse(await response.text(), fetchedAt),
            runtimeSource: endpoint.id,
            runtimeSourceLabel: endpoint.label,
          },
          fetchedAt,
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    async function refreshRealtimeQuote() {
      setRealtimeState((state) => ({
        ...state,
        status: state.quote ? 'refreshing' : 'loading',
        error: null,
      }))

      try {
        let realtimeResult = null
        let lastError = null

        for (const endpoint of realtimeEndpoints) {
          try {
            realtimeResult = await fetchRealtimeEndpoint(endpoint)
            break
          } catch (error) {
            lastError = error
          }
        }

        if (!realtimeResult) {
          throw lastError ?? new Error('实时行情请求失败')
        }
        if (!cancelled) {
          setRealtimeState({
            status: 'success',
            quote: realtimeResult.quote,
            lastUpdated: realtimeResult.fetchedAt.toISOString(),
            error: null,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setRealtimeState((state) => ({
            ...state,
            status: 'error',
            error: error.message,
          }))
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(refreshRealtimeQuote, REALTIME_REFRESH_MS)
        }
      }
    }

    refreshRealtimeQuote()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  const snapshotQuote = useMemo(
    () => ({
      code: etfProfile.code,
      name: etfProfile.name,
      tradeDate: etfProfile.latestTradeDate,
      tradeTime: etfProfile.quote.tradeTime,
      price: etfProfile.price,
      previousClose: etfProfile.previousClose,
      ...etfProfile.quote,
    }),
    [],
  )
  const activeQuote = realtimeState.quote ?? snapshotQuote
  const activePrice = activeQuote.price ?? etfProfile.price
  const activePreviousClose = activeQuote.previousClose ?? etfProfile.previousClose
  const useEstimatedNav =
    Number.isFinite(etfProfile.estimate?.value) &&
    etfProfile.estimate?.date &&
    activeQuote.tradeDate &&
    etfProfile.estimate.date === activeQuote.tradeDate
  const valuationNav = useEstimatedNav ? etfProfile.estimate.value : etfProfile.nav
  const valuationNavLabel = useEstimatedNav ? '估算净值' : '单位净值'
  const valuationNavTime = useEstimatedNav
    ? etfProfile.estimate.time ?? etfProfile.estimate.date
    : etfProfile.latestNavDate
  const quoteForAnalysis = useMemo(
    () => ({
      ...etfProfile.quote,
      ...activeQuote,
    }),
    [activeQuote],
  )
  const premium = calculatePremium(activePrice, valuationNav)
  const dailyChange = calculateDailyChange(activePrice, activePreviousClose)
  const topWeight = sumWeights(holdings)
  const basketGroups = groupHoldingsByBasket(holdings)
  const scenarioState = getScenarioAdjustment(scenario)
  const sourceHealth = useMemo(
    () =>
      (etfProfile.liveSnapshot.sourceHealth ?? []).map((source) => {
        if (source.id !== 'quote') return source
        if (realtimeState.status === 'success') {
          return {
            ...source,
            label: '实时ETF行情',
            ok: true,
            fallback: false,
            runtime: true,
            fetchedAt: realtimeState.lastUpdated,
            error: null,
          }
        }
        if (realtimeState.status === 'error') {
          return {
            ...source,
            label: '实时ETF行情',
            ok: false,
            fallback: true,
            runtime: true,
            error: realtimeState.error ?? source.error,
          }
        }
        return source
      }),
    [realtimeState.error, realtimeState.lastUpdated, realtimeState.status],
  )
  const dataFreshness = useMemo(
    () =>
      buildDataFreshness({
        snapshotGeneratedAt: realtimeState.lastUpdated ?? etfProfile.liveSnapshot.generatedAt,
        quoteTradeDate: activeQuote.tradeDate,
        navDate: useEstimatedNav ? etfProfile.estimate.date : etfProfile.latestNavDate,
        sourceHealth,
      }),
    [
      activeQuote.tradeDate,
      realtimeState.lastUpdated,
      sourceHealth,
      useEstimatedNav,
    ],
  )
  const degradedSources = sourceHealth.filter((source) => source.ok === false)
  const realtimeStatusLabel =
    realtimeState.status === 'success'
      ? `${realtimeState.quote?.runtimeSourceLabel ?? '实时'} ${formatSnapshotTime(realtimeState.lastUpdated)}`
      : realtimeState.status === 'loading' || realtimeState.status === 'refreshing'
        ? '实时连接中'
        : realtimeState.status === 'error'
          ? '实时源降级'
          : '实时待连接'
  const marketStatus = describeMarketStatus({
    quoteTradeDate: activeQuote.tradeDate,
    statusCode: activeQuote.statusCode,
  })
  const snapshotStatusLabel =
    realtimeState.status === 'success'
      ? '运行时实时'
      : etfProfile.liveSnapshot.mode === 'degraded'
      ? '降级缓存'
      : etfProfile.liveSnapshot.mode === 'partial'
      ? '部分刷新'
      : etfProfile.liveSnapshot.mode === 'refreshed'
        ? '已刷新'
        : '种子数据'
  const snapshotLabel =
    etfProfile.liveSnapshot.mode === 'refreshed' ||
    etfProfile.liveSnapshot.mode === 'partial' ||
    etfProfile.liveSnapshot.mode === 'degraded'
      ? `快照 ${formatSnapshotTime(etfProfile.liveSnapshot.generatedAt)}`
      : '种子快照'

  const trendProfile = useMemo(() => buildTrendProfile(etfKlines), [])
  const signal = useMemo(
    () =>
      buildSignalEngine({
        premium,
        dailyChange,
        riskBudget,
        factorBaskets,
        trendProfile,
        quote: quoteForAnalysis,
      }),
    [dailyChange, premium, quoteForAnalysis, riskBudget, trendProfile],
  )
  const backtestStrategies = useMemo(
    () =>
      buildBacktestStrategies({
        klines: etfKlines,
        factorBaskets,
      }),
    [],
  )
  const strategyOptimizer = useMemo(
    () =>
      buildStrategyOptimizer({
        klines: etfKlines,
        factorBaskets,
      }),
    [],
  )
  const tradingQuality = useMemo(
    () =>
      buildTradingQualityProfile({
        etfKlines,
        benchmarkKlines,
        navSeries,
        price: activePrice,
        nav: valuationNav,
        quote: quoteForAnalysis,
      }),
    [activePrice, quoteForAnalysis, valuationNav],
  )
  const primaryDecision = useMemo(
    () =>
      composePrimaryDecision({
        signal,
        optimizer: strategyOptimizer,
        riskBudget,
        trendProfile,
      }),
    [riskBudget, signal, strategyOptimizer, trendProfile],
  )
  const topRiskDrivers = useMemo(
    () =>
      [...commodityDrivers]
        .filter((driver) => Number.isFinite(driver.riskScore))
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 3),
    [],
  )
  const benchmarkStrategy = backtestStrategies.find((strategy) => strategy.id === 'buyHold')

  const stressedPrice = activePrice * (1 + scenarioState.priceShock)
  const stressedVol = riskMetrics.annualVolatility + scenarioState.volShock

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <LineChart size={22} strokeWidth={2.2} />
          </div>
          <div>
            <h1>512400 ETF Research Console</h1>
            <p>{etfProfile.name} · {etfProfile.indexName}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="数据来源说明"
            title="数据来源说明"
            onClick={() => {
              const stamp =
                realtimeState.status === 'success'
                  ? formatSnapshotTime(realtimeState.lastUpdated)
                  : etfProfile.liveSnapshot.mode === 'refreshed' ||
                      etfProfile.liveSnapshot.mode === 'partial' ||
                      etfProfile.liveSnapshot.mode === 'degraded'
                    ? formatSnapshotTime(etfProfile.liveSnapshot.generatedAt)
                    : '种子数据'
              const degradeNote = degradedSources.length
                ? `；降级源：${degradedSources.map((source) => source.label).join('、')}`
                : ''
              const quoteNote =
                realtimeState.status === 'success'
                  ? `实时行情：${activeQuote.tradeTime ?? activeQuote.tradeDate}`
                  : '实时行情：暂用快照缓存'
              setRefreshNote(
                `当前口径：${stamp}，${quoteNote}，${dataFreshness.summary}${degradeNote}。`,
              )
            }}
          >
            <Info size={18} />
          </button>
          <div className={`status-chip ${dataFreshness.tone}`}>{marketStatus}</div>
          <div className={`live-chip ${realtimeState.status}`}>{realtimeStatusLabel}</div>
          <div className={`snapshot-chip ${dataFreshness.tone}`}>{snapshotLabel}</div>
        </div>
      </header>
      {refreshNote ? <div className="refresh-note">{refreshNote}</div> : null}
      {dataFreshness.tone !== 'good' ? (
        <section className={`data-alert ${dataFreshness.tone}`} aria-label="数据新鲜度提示">
          <ShieldAlert size={18} />
          <div>
            <strong>{dataFreshness.summary}</strong>
            <p>{dataFreshness.details.slice(0, 3).join(' · ')}</p>
          </div>
        </section>
      ) : null}

      <section className="command-band">
        <div className="decision-panel">
          <span className={`decision-dot ${primaryDecision.tone}`}></span>
          <div>
            <p>主结论</p>
            <strong>{primaryDecision.action}</strong>
          </div>
          <div className="score-gauge" aria-label={`稳定性 ${primaryDecision.score}`}>
            <span style={{ width: `${primaryDecision.score}%` }}></span>
          </div>
        </div>
        <div className="segmented" aria-label="时间窗口">
          {timeframes.map((item) => (
            <button
              className={item === timeframe ? 'selected' : ''}
              key={item}
              type="button"
              onClick={() => setTimeframe(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="risk-slider">
          <SlidersHorizontal size={18} />
          <span>风险预算 {riskBudget}%</span>
          <input
            type="range"
            min="20"
            max="80"
            value={riskBudget}
            onChange={(event) => setRiskBudget(Number(event.target.value))}
          />
        </label>
      </section>

      <DecisionDeck
        dailyChange={dailyChange}
        premium={premium}
        primaryDecision={primaryDecision}
        signal={signal}
        topRiskDrivers={topRiskDrivers}
        trendProfile={trendProfile}
      />

      <section className="metric-grid secondary-metrics" aria-label="ETF辅助指标">
        <MetricCard label="实时价格" value={activePrice.toFixed(3)} helper={activeQuote.tradeTime ?? activeQuote.tradeDate} icon={Target} />
        <MetricCard label={valuationNavLabel} value={valuationNav.toFixed(4)} helper={`${valuationNavTime} · 折溢价 ${formatSignedPercent(premium)}`} icon={Activity} />
        <MetricCard label="日涨跌" value={formatSignedPercent(dailyChange)} helper={`前收 ${activePreviousClose.toFixed(3)}`} icon={TrendingUp} tone={dailyChange < 0 ? 'down' : 'up'} />
        <MetricCard label="成交额" value={formatCnyAmount(quoteForAnalysis.amountCny)} helper={`换手 ${formatPercent(quoteForAnalysis.turnoverRate ?? 0)}`} icon={BarChart3} />
        <MetricCard label="主仓位" value={formatPercent(primaryDecision.exposure, 0)} helper={`${primaryDecision.source} / ${primaryDecision.rule}`} icon={Gauge} />
        <MetricCard label="基金规模" value={`${formatNumber(etfProfile.netAssets, 2)}亿`} helper={`${formatNumber(etfProfile.shares, 2)}亿份`} icon={Database} />
        <MetricCard label="前十大权重" value={`${topWeight.toFixed(2)}%`} helper={`${etfProfile.sampleCount}只样本股`} icon={Layers3} />
        <MetricCard label="季度跟踪差" value={formatSignedPercent(riskMetrics.trackingGapQ1)} helper={`基准 ${formatPercent(etfProfile.q1BenchmarkReturn)}`} icon={GitBranch} tone="neutral" />
      </section>

      <section className="workspace-grid">
        <Panel className="market-panel" title="趋势与因子" icon={BarChart3}>
          <div className="chart-header">
            <div>
              <strong>{timeframe}窗口</strong>
              <span>ETF、黄金、铜、稀土归一化走势</span>
            </div>
            <ChevronsUpDown size={18} />
          </div>
          <MiniLineChart trendSeries={trendSeries} />
          <div className="factor-grid">
            {factorBaskets.map((factor) => (
              <FactorTile key={factor.key} factor={factor} />
            ))}
          </div>
        </Panel>

        <Panel title="情景压力（What-If）" icon={ShieldAlert}>
          <div className="scenario-tabs">
            {scenarios.map((item) => (
              <button
                className={item.id === scenario ? 'selected' : ''}
                key={item.id}
                type="button"
                onClick={() => setScenario(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="stress-readout">
            <div>
              <span>情景价格</span>
              <strong>{stressedPrice.toFixed(3)}</strong>
            </div>
            <div>
              <span>年化波动</span>
              <strong>{formatPercent(stressedVol)}</strong>
            </div>
          </div>
          <p className="scenario-note">{scenarioState.note}</p>
          <p className="scenario-disclaimer">仅做静态投影，主决策与信号不会随情景重算。</p>
          <RiskStack riskMetrics={riskMetrics} />
        </Panel>

        <Panel title="商品驱动" icon={LineChart}>
          <CommodityDriverPanel commodityDrivers={commodityDrivers} />
        </Panel>

        <Panel title="跟踪与交易质量" icon={GitBranch}>
          <TradingQualityPanel quality={tradingQuality} />
        </Panel>

        <Panel className="signal-panel" title="信号实验室" icon={FlaskConical}>
          <SignalLab signal={signal} trendProfile={trendProfile} riskBudget={riskBudget} />
        </Panel>

        <Panel className="optimizer-panel" title="自动策略优化" icon={Target}>
          <StrategyOptimizer optimizer={strategyOptimizer} />
        </Panel>

        <Panel className="holdings-panel" title="持仓暴露" icon={Layers3}>
          <div className="basket-strip">
            {basketGroups.map((group) => (
              <div key={group.basket}>
                <span>{group.basket}</span>
                <strong>{group.weight.toFixed(2)}%</strong>
              </div>
            ))}
          </div>
          <HoldingsTable holdings={holdings} />
        </Panel>

        <Panel title="策略回测" icon={Activity}>
          <div className="backtest-summary">
            <div>
              <span>K线样本</span>
              <strong>{trendProfile.sampleSize}日</strong>
            </div>
            <div>
              <span>基准参考</span>
              <strong>{formatPercent(benchmarkStrategy?.benchmarkAnnualReturn ?? 0, 1)}</strong>
            </div>
          </div>
          <div className="strategy-list">
            {backtestStrategies.map((strategy) => (
              <StrategyRow key={strategy.id} strategy={strategy} />
            ))}
          </div>
        </Panel>

        <Panel title="事件流" icon={AlertTriangle}>
          <div className="event-list">
            {eventLog.map((event) => (
              <article className={`event-row ${event.severity}`} key={`${event.date}-${event.title}`}>
                <time>{event.date}</time>
                <div>
                  <span>{event.type}</span>
                  <strong>{event.title}</strong>
                  <p>{event.impact}</p>
                </div>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="数据管线" icon={Database}>
          <div className="snapshot-readout">
            <div>
              <span>快照状态</span>
              <strong>{snapshotStatusLabel}</strong>
            </div>
            <div>
              <span>实时行情</span>
              <strong>{realtimeStatusLabel}</strong>
            </div>
            <div>
              <span>刷新时间</span>
              <strong>{formatSnapshotTime(etfProfile.liveSnapshot.generatedAt)}</strong>
            </div>
            <div>
              <span>K线样本</span>
              <strong>{trendProfile.sampleSize}日</strong>
            </div>
            <div>
              <span>历史缓存</span>
              <strong>{snapshotHistory.length}条</strong>
            </div>
            <div>
              <span>健康状态</span>
              <strong>{dataFreshness.summary}</strong>
            </div>
            <div>
              <span>降级源</span>
              <strong>{degradedSources.length}个</strong>
            </div>
          </div>
          {sourceHealth.length ? (
            <div className="source-health-list" aria-label="数据源健康状态">
              {sourceHealth.map((source) => (
                <div
                  className={`source-health-row ${
                    source.ok ? 'ok' : source.required ? 'danger' : 'warning'
                  }`}
                  key={source.id}
                >
                  <span>{source.label}</span>
                  <strong>
                    {source.runtime && source.ok
                      ? '实时'
                      : source.ok
                        ? '正常'
                        : source.fallback
                          ? '缓存'
                          : '失败'}
                  </strong>
                </div>
              ))}
            </div>
          ) : null}
          <div className="source-list">
            {dataSources.map((source) => (
              <span key={source}>{source}</span>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  )
}

export default App
