import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CheckCircle2,
  ChevronsUpDown,
  Database,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers3,
  LineChart,
  RefreshCw,
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
  formatCnyAmount,
  formatNumber,
  formatPercent,
  formatSnapshotTime,
  formatSignedPercent,
  getScenarioAdjustment,
  groupHoldingsByBasket,
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

function App() {
  const [timeframe, setTimeframe] = useState('60日')
  const [scenario, setScenario] = useState('base')
  const [riskBudget, setRiskBudget] = useState(48)
  const [alertsEnabled, setAlertsEnabled] = useState(true)
  const [refreshNote, setRefreshNote] = useState('')

  const premium = calculatePremium(etfProfile.price, etfProfile.nav)
  const dailyChange = calculateDailyChange(etfProfile.price, etfProfile.previousClose)
  const topWeight = sumWeights(holdings)
  const basketGroups = groupHoldingsByBasket(holdings)
  const scenarioState = getScenarioAdjustment(scenario)
  const snapshotLabel =
    etfProfile.liveSnapshot.mode === 'refreshed'
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
        quote: etfProfile.quote,
      }),
    [dailyChange, premium, riskBudget, trendProfile],
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
        price: etfProfile.price,
        nav: etfProfile.nav,
        quote: etfProfile.quote,
      }),
    [],
  )
  const primaryDecision = useMemo(() => {
    if (strategyOptimizer.ok) {
      const best = strategyOptimizer.best
      return {
        action: best.current.action,
        tone: best.current.tone,
        score: best.stabilityScore,
        exposure: Math.min(best.current.exposure, riskBudget / 100),
        source: '自动优化',
        rule: best.label,
        overfitRisk: best.overfitRisk,
        stabilityScore: best.stabilityScore,
      }
    }

    return {
      action: signal.action,
      tone: signal.tone,
      score: signal.score,
      exposure: signal.suggestedExposure,
      source: '信号引擎',
      rule: trendProfile.state,
      overfitRisk: '暂无',
      stabilityScore: signal.confidence,
    }
  }, [riskBudget, signal, strategyOptimizer, trendProfile.state])
  const topRiskDrivers = useMemo(
    () =>
      [...commodityDrivers]
        .filter((driver) => Number.isFinite(driver.riskScore))
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 3),
    [],
  )
  const benchmarkStrategy = backtestStrategies.find((strategy) => strategy.id === 'buyHold')

  const stressedPrice = etfProfile.price * (1 + scenarioState.priceShock)
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
            className={`icon-button ${alertsEnabled ? 'is-active' : ''}`}
            type="button"
            onClick={() => setAlertsEnabled((value) => !value)}
            aria-label="切换预警"
            title="切换预警"
          >
            <Bell size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="刷新快照"
            title="刷新快照"
            onClick={() => setRefreshNote(`页面已读取 ${snapshotLabel}`)}
          >
            <RefreshCw size={18} />
          </button>
          <div className="status-chip">{etfProfile.marketStatus}</div>
          <div className="snapshot-chip">{snapshotLabel}</div>
        </div>
      </header>
      {refreshNote ? <div className="refresh-note">{refreshNote}</div> : null}

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
        <MetricCard label="最新价格" value={etfProfile.price.toFixed(3)} helper={etfProfile.quote.tradeTime ?? etfProfile.latestTradeDate} icon={Target} />
        <MetricCard label="单位净值" value={etfProfile.nav.toFixed(4)} helper={`折溢价 ${formatSignedPercent(premium)}`} icon={Activity} />
        <MetricCard label="日涨跌" value={formatSignedPercent(dailyChange)} helper={`前收 ${etfProfile.previousClose.toFixed(3)}`} icon={TrendingUp} tone={dailyChange < 0 ? 'down' : 'up'} />
        <MetricCard label="成交额" value={formatCnyAmount(etfProfile.quote.amountCny)} helper={`换手 ${formatPercent(etfProfile.quote.turnoverRate ?? 0)}`} icon={BarChart3} />
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

        <Panel title="情景压力" icon={ShieldAlert}>
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
              <strong>{etfProfile.liveSnapshot.mode === 'refreshed' ? '已刷新' : '种子数据'}</strong>
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
          </div>
          <div className="pipeline">
            {['行情快照', 'ETF日线', '基准跟踪', '净值核算', '商品驱动', '历史缓存', '持仓映射', '因子归因', '策略回测', '自动优化', '风险输出'].map((item, index) => (
              <div className="pipeline-step" key={item}>
                <CheckCircle2 size={17} />
                <span>{index + 1}</span>
                <strong>{item}</strong>
              </div>
            ))}
          </div>
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
