import liveSnapshot from './liveSnapshot.json'
import historySnapshots from './history/512400-snapshots.json'
import { buildDataFreshness, describeMarketStatus } from '../analysis/snapshotHealth'
import { summarizeSourceHealth } from './sourceHealthContract'

const quoteSnapshot = liveSnapshot.quote ?? {}
const navSnapshot = liveSnapshot.nav ?? {}
const estimateSnapshot = liveSnapshot.estimate ?? {}
const performanceSnapshot = liveSnapshot.performance ?? {}
const commoditySnapshot = liveSnapshot.commodityDrivers ?? []
const klineSnapshot = liveSnapshot.etfKlines ?? []
const benchmarkKlineSnapshot = liveSnapshot.benchmarkKlines ?? []
const navTrendSnapshot = liveSnapshot.navTrend ?? []
const sourceHealthSnapshot = liveSnapshot.meta?.sourceHealth ?? []

const dataFreshness = buildDataFreshness({
  snapshotGeneratedAt: liveSnapshot.meta?.generatedAt,
  quoteTradeDate: quoteSnapshot.tradeDate,
  navDate: navSnapshot.date,
  sourceHealth: sourceHealthSnapshot,
})

export const sourceHealthContract = summarizeSourceHealth(
  sourceHealthSnapshot.map((source) => ({
    id: source.id,
    label: source.label,
    required: source.required,
    ok: source.ok,
    fallback: source.fallback,
    asOf: source.fetchedAt ?? liveSnapshot.meta?.generatedAt,
  })),
)

function driverFor(key) {
  return commoditySnapshot.find((driver) => driver.key === key && driver.ok)
}

function liveTrend(key, fallback) {
  return driverFor(key)?.trendScore ?? fallback
}

function liveRisk(key, fallback) {
  return driverFor(key)?.riskScore ?? fallback
}

function liveContribution(key, weight, fallback) {
  const changePercent = driverFor(key)?.quote?.changePercent
  if (!Number.isFinite(changePercent)) return fallback
  return Number((weight * changePercent).toFixed(2))
}

const internationalCommodityReferenceByKey = {
  gold: {
    key: 'gold',
    secid: '101.GC00Y',
    label: 'COMEX黄金',
    unit: '美元/盎司',
    source: 'COMEX',
    price: 4544.4,
    previousClose: 4558,
    change: -13.6,
    changePercent: -0.003,
    tradeDate: '2026-05-19',
    tradeTime: '2026-05-19 16:24:47',
    sourceUrl: 'https://quote.eastmoney.com/unify/r/101.GC00Y',
    fallback: true,
  },
  copper: {
    key: 'copper',
    secid: '109.LCPT',
    label: 'LME铜03',
    unit: '美元/吨',
    source: 'LME',
    price: 13506.5,
    previousClose: 13590,
    change: -83.5,
    changePercent: -0.0061,
    tradeDate: '2026-05-19',
    tradeTime: '2026-05-19 16:28:00',
    sourceUrl: 'https://quote.eastmoney.com/unify/r/109.LCPT',
    fallback: true,
  },
  aluminum: {
    key: 'aluminum',
    secid: '109.LALT',
    label: 'LME铝03',
    unit: '美元/吨',
    source: 'LME',
    price: 3580,
    previousClose: 3557.5,
    change: 22.5,
    changePercent: 0.0063,
    tradeDate: '2026-05-19',
    tradeTime: '2026-05-19 16:28:00',
    sourceUrl: 'https://quote.eastmoney.com/unify/r/109.LALT',
    fallback: true,
  },
}

function normalizeInternationalReference(reference) {
  if (!reference) return null
  return {
    key: reference.key,
    secid: reference.secid,
    label: reference.label,
    unit: reference.unit,
    source: reference.source,
    price: reference.quote?.price ?? reference.price,
    previousClose: reference.quote?.previousClose ?? reference.previousClose,
    change: reference.quote?.change ?? reference.change,
    changePercent: reference.quote?.changePercent ?? reference.changePercent,
    tradeDate: reference.quote?.tradeDate ?? reference.tradeDate,
    tradeTime: reference.quote?.tradeTime ?? reference.tradeTime,
    sourceUrl: reference.sourceUrl,
    fallback: reference.fallback ?? false,
  }
}

export const etfProfile = {
  code: '512400',
  name: '有色金属ETF南方',
  fullName: '南方中证申万有色金属交易型开放式指数证券投资基金',
  indexName: '中证申万有色金属指数',
  manager: '南方基金',
  custodian: '工商银行',
  fundManager: '崔蕾',
  inceptionDate: '2017-08-03',
  latestTradeDate: quoteSnapshot.tradeDate ?? '2026-04-30',
  latestNavDate: navSnapshot.date ?? '2026-04-30',
  marketStatus: describeMarketStatus({
    quoteTradeDate: quoteSnapshot.tradeDate,
    statusCode: quoteSnapshot.statusCode,
  }),
  price: quoteSnapshot.price ?? 2.119,
  previousClose: quoteSnapshot.previousClose ?? 2.14,
  nav: navSnapshot.unit ?? 2.117,
  q1Nav: 1.9777,
  q1Return: 0.0265,
  q1BenchmarkReturn: 0.0293,
  netAssets: 275.67,
  shares: 139.3854,
  managementFee: 0.005,
  custodyFee: 0.001,
  q1EquityWeight: 0.9942,
  sampleCount: 50,
  rebalance: '6月 / 12月',
  singleNameCap: 0.1,
  quote: {
    tradeDate: quoteSnapshot.tradeDate,
    tradeTime: quoteSnapshot.tradeTime,
    price: quoteSnapshot.price,
    previousClose: quoteSnapshot.previousClose,
    open: quoteSnapshot.open,
    high: quoteSnapshot.high,
    low: quoteSnapshot.low,
    changePercent: quoteSnapshot.changePercent,
    amountCny: quoteSnapshot.amountCny,
    turnoverRate: quoteSnapshot.turnoverRate,
    totalMarketValueCny: quoteSnapshot.totalMarketValueCny,
    statusCode: quoteSnapshot.statusCode,
  },
  navSnapshot: {
    dailyReturn: navSnapshot.dailyReturn,
    accumulated: navSnapshot.accumulated,
    source: navSnapshot.source,
  },
  estimate: estimateSnapshot,
  performance: performanceSnapshot,
  liveSnapshot: {
    generatedAt: liveSnapshot.meta?.generatedAt,
    mode: liveSnapshot.meta?.mode ?? 'seed',
    sources: liveSnapshot.meta?.sources ?? [],
    sourceHealth: sourceHealthSnapshot,
    dataFreshness,
    sourceHealthContract,
    history: liveSnapshot.history,
  },
}

export const holdings = [
  {
    code: '601899',
    name: '紫金矿业',
    weight: 9.44,
    basket: '黄金铜',
    marketValue: 260170.33,
    signal: '核心权重',
  },
  {
    code: '603993',
    name: '洛阳钼业',
    weight: 6.8,
    basket: '铜钼钴',
    marketValue: 187360.29,
    signal: '供给弹性',
  },
  {
    code: '600111',
    name: '北方稀土',
    weight: 5.48,
    basket: '稀土',
    marketValue: 151087.61,
    signal: '政策弹性',
  },
  {
    code: '601600',
    name: '中国铝业',
    weight: 4.1,
    basket: '铝',
    marketValue: 113035.56,
    signal: '成本周期',
  },
  {
    code: '603799',
    name: '华友钴业',
    weight: 4.05,
    basket: '锂钴',
    marketValue: 111560.87,
    signal: '电池金属',
  },
  {
    code: '002460',
    name: '赣锋锂业',
    weight: 4.02,
    basket: '锂钴',
    marketValue: 110928.27,
    signal: '储能需求',
  },
  {
    code: '600489',
    name: '中金黄金',
    weight: 3.53,
    basket: '黄金',
    marketValue: 97314.67,
    signal: '避险资产',
  },
  {
    code: '600547',
    name: '山东黄金',
    weight: 3.31,
    basket: '黄金',
    marketValue: 91130.57,
    signal: '黄金 beta',
  },
  {
    code: '600988',
    name: '赤峰黄金',
    weight: 3.26,
    basket: '黄金',
    marketValue: 89946.76,
    signal: '成长黄金',
  },
  {
    code: '000807',
    name: '云铝股份',
    weight: 2.93,
    basket: '铝',
    marketValue: 80817.59,
    signal: '电解铝',
  },
]

export const factorBaskets = [
  {
    key: 'gold',
    name: '黄金链',
    weight: 19.54,
    trend: liveTrend('gold', 78),
    risk: liveRisk('gold', 62),
    contribution: liveContribution('gold', 19.54, 1.84),
    color: '#c58a2c',
    detail: '紫金矿业、中金黄金、山东黄金、赤峰黄金',
    driverKey: 'gold',
  },
  {
    key: 'copper',
    name: '铜钼链',
    weight: 16.24,
    trend: liveTrend('copper', 72),
    risk: liveRisk('copper', 58),
    contribution: liveContribution('copper', 16.24, 1.31),
    color: '#b96836',
    detail: '紫金矿业、洛阳钼业',
    driverKey: 'copper',
  },
  {
    key: 'rareEarth',
    name: '稀土链',
    weight: 5.48,
    trend: liveTrend('rareEarth', 68),
    risk: liveRisk('rareEarth', 74),
    contribution: liveContribution('rareEarth', 5.48, 0.7),
    color: '#5f7f56',
    detail: '北方稀土',
    driverKey: 'rareEarth',
  },
  {
    key: 'aluminum',
    name: '铝链',
    weight: 7.03,
    trend: liveTrend('aluminum', 57),
    risk: liveRisk('aluminum', 45),
    contribution: liveContribution('aluminum', 7.03, 0.46),
    color: '#73808e',
    detail: '中国铝业、云铝股份',
    driverKey: 'aluminum',
  },
  {
    key: 'battery',
    name: '锂钴链',
    weight: 8.07,
    trend: liveTrend('battery', 51),
    risk: liveRisk('battery', 81),
    contribution: liveContribution('battery', 8.07, -0.2),
    color: '#337f8c',
    detail: '华友钴业、赣锋锂业',
    driverKey: 'battery',
  },
]

export const commodityDrivers = commoditySnapshot.map((driver) => ({
  key: driver.key,
  label: driver.label,
  unit: driver.unit,
  source: driver.source,
  ok: driver.ok,
  price: driver.quote?.price,
  changePercent: driver.quote?.changePercent,
  tradeDate: driver.quote?.tradeDate,
  tradeTime: driver.quote?.tradeTime,
  return5: driver.metrics?.return5,
  return20: driver.metrics?.return20,
  return60: driver.metrics?.return60,
  volatility: driver.metrics?.volatility,
  trendScore: driver.trendScore,
  riskScore: driver.riskScore,
  klines: driver.klines ?? [],
  international: normalizeInternationalReference(
    driver.international ?? internationalCommodityReferenceByKey[driver.key],
  ),
}))

export const etfKlines = klineSnapshot.map((item) => ({
  date: item.date,
  open: item.open,
  close: item.close,
  high: item.high,
  low: item.low,
  volume: item.volume,
  amount: item.amount,
  amplitude: item.amplitude,
  changePercent: item.changePercent,
  change: item.change,
}))

export const benchmarkKlines = benchmarkKlineSnapshot.map((item) => ({
  date: item.date,
  open: item.open,
  close: item.close,
  high: item.high,
  low: item.low,
  volume: item.volume,
  amount: item.amount,
  amplitude: item.amplitude,
  changePercent: item.changePercent,
  change: item.change,
}))

export const navSeries = navTrendSnapshot.map((item) => ({
  date: item.date,
  unit: item.unit,
  dailyReturn: item.dailyReturn,
  accumulated: item.accumulated,
}))

export const snapshotHistory = Array.isArray(historySnapshots) ? historySnapshots : []

// 把 K 线压缩成月末归一化序列：按月份取最后一根，再用第一个月做基期。
// 商品因子的 K 线长度可能不够月度数据时直接返回空数组（图上对应线消失）。
function buildMonthlyClose(klines, months = 12) {
  if (!Array.isArray(klines) || klines.length === 0) return []
  const sorted = [...klines]
    .filter((item) => item?.date && Number.isFinite(item.close))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
  if (!sorted.length) return []
  const monthEnd = new Map()
  sorted.forEach((item) => {
    const month = String(item.date).slice(0, 7)
    if (month) monthEnd.set(month, item.close)
  })
  const entries = Array.from(monthEnd.entries()).slice(-months)
  if (!entries.length) return []
  const base = entries[0][1]
  if (!base) return []
  return entries.map(([month, close]) => ({ month, value: close / base }))
}

const trendKeyMap = [
  { key: 'etf', source: klineSnapshot },
  { key: 'gold', source: commoditySnapshot.find((d) => d.key === 'gold')?.klines ?? [] },
  { key: 'copper', source: commoditySnapshot.find((d) => d.key === 'copper')?.klines ?? [] },
  { key: 'rareEarth', source: commoditySnapshot.find((d) => d.key === 'rareEarth')?.klines ?? [] },
]

const monthlyByKey = new Map(
  trendKeyMap.map(({ key, source }) => [key, buildMonthlyClose(source)]),
)
const etfMonths = monthlyByKey.get('etf') ?? []

export const trendSeries = etfMonths.length
  ? etfMonths.map(({ month, value }) => {
      const point = { date: month, etf: value }
      ;['gold', 'copper', 'rareEarth'].forEach((key) => {
        const match = monthlyByKey.get(key)?.find((item) => item.month === month)
        if (match) point[key] = match.value
      })
      return point
    })
  : []

export const riskMetrics = {
  annualVolatility: 0.356,
  maxDrawdown: -0.312,
  oneDayVar95: -0.031,
  oneDayCvar95: -0.047,
  concentrationTop10: 46.92,
  trackingGapQ1: -0.0028,
  liquidityScore: 84,
  crowdingScore: 68,
  riskLabel: '高波动',
}

export const eventLog = [
  {
    date: '2026-04-30',
    type: '交易',
    title: '节前最后交易日',
    impact: '价格2.119，净值2.117，折溢价约0.09%',
    severity: 'neutral',
  },
  {
    date: '2026-04-22',
    type: '公告',
    title: '2026年一季报披露',
    impact: '权益仓位99.42%，前十大权重46.92%',
    severity: 'info',
  },
  {
    date: '2026-03-31',
    type: '风控',
    title: '一季度急涨急跌',
    impact: '基金净值季度涨2.65%，板块波动显著放大',
    severity: 'warning',
  },
  {
    date: '2026-01-31',
    type: '因子',
    title: '黄金、铜、稀土共振',
    impact: '指数单月涨幅超20%，拥挤度上升',
    severity: 'positive',
  },
]

export const dataSources = [
  ...(liveSnapshot.meta?.sources ?? []),
  '上交所 2026年第1季度报告',
  '中证申万有色金属指数编制方案',
  '天天基金 512400 基金档案',
  '东方财富行情快照 2026-04-30',
]
