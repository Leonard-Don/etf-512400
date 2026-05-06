import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const outputPath = resolve(projectRoot, 'src/data/liveSnapshot.json')
const historyPath = resolve(projectRoot, 'src/data/history/512400-snapshots.json')

const quoteUrl =
  'https://push2.eastmoney.com/api/qt/stock/get?secid=1.512400&fields=f43,f44,f45,f46,f47,f48,f50,f57,f58,f59,f60,f71,f86,f116,f117,f168,f169,f170,f171,f292'
const fundGaugeUrl = `https://fundgz.1234567.com.cn/js/512400.js?rt=${Date.now()}`
const fundTrendUrl = `https://fund.eastmoney.com/pingzhongdata/512400.js?v=${Date.now()}`
const quoteFields =
  'f43,f44,f45,f46,f47,f48,f50,f57,f58,f59,f60,f71,f86,f107,f152,f169,f170,f171,f292'
const klineFields =
  'fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
const etfKlineUrl =
  `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.512400&klt=101&fqt=1&lmt=280&end=20500101&${klineFields}`
const benchmarkKlineUrl =
  `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000819&klt=101&fqt=1&lmt=280&end=20500101&${klineFields}`
const sourceLabels = {
  quote: 'ETF行情',
  etfKlines: '512400 日K',
  benchmarkKlines: '000819 基准日K',
  fundGauge: '盘中估算净值',
  fundTrend: '基金净值趋势',
  commodityDrivers: '商品驱动',
}

const commodityContracts = [
  {
    key: 'gold',
    secid: '113.aum',
    label: '沪金主连',
    unit: '元/克',
    source: 'SHFE',
  },
  {
    key: 'copper',
    secid: '113.cum',
    label: '沪铜主连',
    unit: '元/吨',
    source: 'SHFE',
  },
  {
    key: 'aluminum',
    secid: '113.alm',
    label: '沪铝主连',
    unit: '元/吨',
    source: 'SHFE',
  },
  {
    key: 'battery',
    secid: '225.lcm',
    label: '碳酸锂主连',
    unit: '元/吨',
    source: 'GFEX',
  },
  {
    key: 'rareEarth',
    secid: '2.930598',
    label: '稀土产业',
    unit: '点',
    source: 'CSI',
  },
]

// 指数退避重试 fetchText：429/5xx/网络抖动重试 3 次，4xx 立即失败
async function fetchText(url, { attempts = 3, timeoutMs = 8000 } = {}) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        headers: {
          Accept: '*/*',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
        },
        signal: controller.signal,
      })

      if (response.ok) {
        const text = await response.text()
        clearTimeout(timeout)
        return text
      }

      const retryable = response.status === 429 || response.status >= 500
      const error = new Error(`Fetch failed ${response.status} ${url}`)
      if (!retryable) throw error
      lastError = error
    } catch (error) {
      clearTimeout(timeout)
      lastError = error
    }

    if (attempt < attempts - 1) {
      const delay = 300 * 2 ** attempt
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError ?? new Error(`Fetch failed without details: ${url}`)
}

// 控制并发上限的简易调度器，避免一次性向接口发出过多请求
async function runLimited(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

function hasUsableValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return value !== null && value !== undefined
}

function summarizeError(error) {
  const code = error?.cause?.code ?? error?.code
  if (code && error?.message) return `${code}: ${error.message}`
  return error?.message ?? String(error)
}

function sourceHealth(source, ok, extra = {}) {
  return {
    id: source.id,
    label: source.label,
    required: source.required,
    ok,
    fetchedAt: new Date().toISOString(),
    ...extra,
  }
}

async function fetchParsedSource(source) {
  try {
    const text = await fetchText(source.url, {
      attempts: source.attempts ?? 3,
      timeoutMs: source.timeoutMs ?? 8000,
    })
    const value = source.parse(text)
    if (!hasUsableValue(value)) {
      throw new Error(`${source.label} 解析结果为空`)
    }
    return {
      id: source.id,
      value,
      health: sourceHealth(source, true, { fallback: false }),
    }
  } catch (error) {
    if (hasUsableValue(source.fallback)) {
      return {
        id: source.id,
        value: source.fallback,
        health: sourceHealth(source, false, {
          fallback: true,
          error: summarizeError(error),
        }),
      }
    }

    return {
      id: source.id,
      value: null,
      health: sourceHealth(source, false, {
        fallback: false,
        error: summarizeError(error),
      }),
    }
  }
}

function priceFromEastmoney(value) {
  if (typeof value !== 'number' || value <= 0) return null
  return Number((value / 1000).toFixed(4))
}

function priceFromQuote(value, decimals) {
  if (typeof value !== 'number' || value <= 0) return null
  if (Number.isInteger(decimals) && decimals >= 0) {
    return Number((value / 10 ** decimals).toFixed(Math.min(decimals, 4)))
  }
  return priceFromEastmoney(value)
}

function percentFromEastmoney(value) {
  if (typeof value !== 'number') return null
  return Number((value / 10000).toFixed(4))
}

function shanghaiDateTimeFromEpoch(seconds) {
  if (!seconds) return { date: null, time: null }
  const date = new Date(seconds * 1000)
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const read = (type) => parts.find((part) => part.type === type)?.value
  const day = `${read('year')}-${read('month')}-${read('day')}`
  const time = `${read('hour')}:${read('minute')}:${read('second')}`
  return { date: day, time: `${day} ${time}` }
}

function extractAssignment(text, name) {
  const marker = `${name} = `
  const start = text.indexOf(marker)
  if (start === -1) return null
  const valueStart = start + marker.length
  const end = text.indexOf(';', valueStart)
  if (end === -1) return null
  return text.slice(valueStart, end)
}

function extractQuotedNumber(text, name) {
  const match = text.match(new RegExp(`var ${name}="([^"]*)"`))
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value / 100 : null
}

function parseFundGauge(text) {
  const match = text.match(/^jsonpgz\((.*)\);?$/)
  if (!match) return null
  const payload = JSON.parse(match[1])
  return {
    date: payload.gztime?.slice(0, 10) ?? payload.jzrq,
    value: Number(payload.gsz),
    changePercent: Number(payload.gszzl) / 100,
    time: payload.gztime,
    previousNavDate: payload.jzrq,
    previousUnitNav: Number(payload.dwjz),
    source: 'fundgz.1234567.com.cn',
  }
}

function parseFundTrend(text) {
  const trendText = extractAssignment(text, 'Data_netWorthTrend')
  if (!trendText) {
    throw new Error(
      'parseFundTrend: 未找到 Data_netWorthTrend 赋值，pingzhongdata 字段名可能已变更',
    )
  }
  const accumulatedText = extractAssignment(text, 'Data_ACWorthTrend')
  const trend = JSON.parse(trendText)
  const accumulated = accumulatedText ? JSON.parse(accumulatedText) : []
  const latest = trend.at(-1)
  const latestAccumulated = accumulated.at(-1)
  const accumulatedByDate = new Map(
    accumulated.map((item) => [
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(item[0])),
      Number(item[1]),
    ]),
  )
  const date = latest?.x
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(latest.x))
    : null
  const navTrend = trend
    .map((item) => {
      const itemDate = item.x
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(item.x))
        : null

      return {
        date: itemDate,
        unit: Number(item.y),
        dailyReturn: Number(item.equityReturn) / 100,
        accumulated: itemDate ? accumulatedByDate.get(itemDate) ?? null : null,
      }
    })
    .filter((item) => item.date && Number.isFinite(item.unit))
    .slice(-280)

  if (navTrend.length === 0) {
    throw new Error('parseFundTrend: navTrend 为空，可能解析逻辑或上游数据异常')
  }

  return {
    nav: latest
      ? {
          date,
          unit: Number(latest.y),
          dailyReturn: Number(latest.equityReturn) / 100,
          accumulated: latestAccumulated ? Number(latestAccumulated[1]) : null,
          source: 'fund.eastmoney.com/pingzhongdata',
        }
      : null,
    navTrend,
    performance: {
      oneMonth: extractQuotedNumber(text, 'syl_1y'),
      threeMonth: extractQuotedNumber(text, 'syl_3y'),
      sixMonth: extractQuotedNumber(text, 'syl_6y'),
      oneYear: extractQuotedNumber(text, 'syl_1n'),
    },
  }
}

function parseQuote(text) {
  const payload = JSON.parse(text)
  if (payload.rc !== 0 || !payload.data) {
    throw new Error(`Unexpected Eastmoney quote payload: ${text.slice(0, 120)}`)
  }

  const data = payload.data
  const tradeClock = shanghaiDateTimeFromEpoch(data.f86)
  const price = priceFromQuote(data.f43, data.f59)
  const previousClose = priceFromQuote(data.f60, data.f59)

  if (!data.f57 || price === null || previousClose === null) {
    throw new Error(
      `parseQuote: 关键字段缺失 (code=${data.f57 ?? 'null'}, price=${data.f43 ?? 'null'}, prev=${data.f60 ?? 'null'})`,
    )
  }

  return {
    code: data.f57,
    name: data.f58,
    tradeDate: tradeClock.date,
    tradeTime: tradeClock.time,
    price,
    previousClose,
    open: priceFromQuote(data.f46, data.f59),
    high: priceFromQuote(data.f44, data.f59),
    low: priceFromQuote(data.f45, data.f59),
    averagePrice: priceFromQuote(data.f71, data.f59),
    change: price !== null && previousClose !== null ? Number((price - previousClose).toFixed(4)) : null,
    changePercent: percentFromEastmoney(data.f170),
    amountCny: data.f48,
    volumeLots: data.f47,
    turnoverRate: percentFromEastmoney(data.f168),
    statusCode: data.f292,
    totalMarketValueCny: data.f116,
  }
}

function parseSecurityQuote(text, contract) {
  const payload = JSON.parse(text)
  if (payload.rc !== 0 || !payload.data) {
    throw new Error(`Unexpected quote payload for ${contract.secid}: ${text.slice(0, 120)}`)
  }

  const data = payload.data
  const tradeClock = shanghaiDateTimeFromEpoch(data.f86)
  const price = priceFromQuote(data.f43, data.f59)
  const previousClose = priceFromQuote(data.f60, data.f59)

  return {
    key: contract.key,
    secid: contract.secid,
    code: data.f57,
    name: data.f58 || contract.label,
    label: contract.label,
    unit: contract.unit,
    source: contract.source,
    tradeDate: tradeClock.date,
    tradeTime: tradeClock.time,
    price,
    previousClose,
    open: priceFromQuote(data.f46, data.f59),
    high: priceFromQuote(data.f44, data.f59),
    low: priceFromQuote(data.f45, data.f59),
    averagePrice: priceFromQuote(data.f71, data.f59),
    change: price !== null && previousClose !== null ? Number((price - previousClose).toFixed(4)) : null,
    changePercent: percentFromEastmoney(data.f170),
    amountCny: data.f48,
    volumeLots: data.f47,
    amplitude: percentFromEastmoney(data.f171),
    statusCode: data.f292,
  }
}

function parseKlines(text) {
  const payload = JSON.parse(text)
  if (payload.rc !== 0 || !payload.data?.klines) {
    throw new Error(`parseKlines: 接口返回异常 (rc=${payload.rc ?? 'null'})`)
  }
  if (payload.data.klines.length === 0) {
    throw new Error('parseKlines: klines 数组为空')
  }

  return payload.data.klines.map((line) => {
    const [date, open, close, high, low, volume, amount, amplitude, changePercent, change] =
      line.split(',')
    return {
      date,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number(amount),
      amplitude: Number(amplitude) / 100,
      changePercent: Number(changePercent) / 100,
      change: Number(change),
    }
  })
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function trailingReturn(klines, days) {
  if (klines.length <= days) return null
  const latest = klines.at(-1).close
  const base = klines.at(-1 - days).close
  if (!base) return null
  return latest / base - 1
}

function realizedVolatility(klines) {
  const returns = klines
    .slice(-40)
    .map((item) => item.changePercent)
    .filter((item) => Number.isFinite(item))
  if (returns.length < 2) return null
  const mean = returns.reduce((sum, item) => sum + item, 0) / returns.length
  const variance =
    returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252)
}

function trendScoreFromReturns(return20, return60) {
  const shortScore = Number.isFinite(return20) ? return20 * 260 : 0
  const mediumScore = Number.isFinite(return60) ? return60 * 140 : 0
  return Math.round(clamp(50 + shortScore + mediumScore, 0, 100))
}

function riskScoreFromVolatility(volatility) {
  if (!Number.isFinite(volatility)) return 50
  return Math.round(clamp(volatility * 180, 15, 95))
}

function buildHistoryPoint(snapshot) {
  const premium =
    snapshot.quote?.price && snapshot.nav?.unit ? snapshot.quote.price / snapshot.nav.unit - 1 : null

  return {
    generatedAt: snapshot.meta.generatedAt,
    tradeDate: snapshot.quote?.tradeDate ?? snapshot.nav?.date ?? null,
    tradeTime: snapshot.quote?.tradeTime ?? null,
    price: snapshot.quote?.price ?? null,
    nav: snapshot.nav?.unit ?? null,
    premium,
    changePercent: snapshot.quote?.changePercent ?? null,
    amountCny: snapshot.quote?.amountCny ?? null,
    turnoverRate: snapshot.quote?.turnoverRate ?? null,
    drivers: snapshot.commodityDrivers.map((driver) => ({
      key: driver.key,
      ok: driver.ok,
      price: driver.quote?.price ?? null,
      changePercent: driver.quote?.changePercent ?? null,
      trendScore: driver.trendScore ?? null,
      riskScore: driver.riskScore ?? null,
    })),
  }
}

async function writeSnapshotHistory(snapshot) {
  const existing = await readJsonFile(historyPath, [])
  const history = Array.isArray(existing) ? existing : []
  const nextPoint = buildHistoryPoint(snapshot)
  const sameSessionKey = nextPoint.tradeTime ?? nextPoint.tradeDate ?? nextPoint.generatedAt
  const compacted = history.filter((point) => {
    const pointKey = point.tradeTime ?? point.tradeDate ?? point.generatedAt
    return pointKey !== sameSessionKey
  })
  const nextHistory = [...compacted, nextPoint]
    .sort((a, b) => new Date(a.generatedAt) - new Date(b.generatedAt))
    .slice(-260)

  await mkdir(dirname(historyPath), { recursive: true })
  await writeFile(historyPath, `${JSON.stringify(nextHistory, null, 2)}\n`, 'utf8')

  return {
    path: 'src/data/history/512400-snapshots.json',
    count: nextHistory.length,
    latestGeneratedAt: nextHistory.at(-1)?.generatedAt ?? null,
    latestTradeDate: nextHistory.at(-1)?.tradeDate ?? null,
  }
}

async function fetchCommodityDriver(contract, fallbackDriver) {
  try {
    const quoteRequest = fetchText(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=${contract.secid}&fields=${quoteFields}`,
      { attempts: 1, timeoutMs: 6000 },
    )
    const klineRequest = fetchText(
      `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${contract.secid}&klt=101&fqt=0&lmt=70&end=20500101&${klineFields}`,
      { attempts: 1, timeoutMs: 6000 },
    )

    const [quoteText, klineText] = await Promise.all([quoteRequest, klineRequest])
    const quote = parseSecurityQuote(quoteText, contract)
    const klines = parseKlines(klineText)
    const return5 = trailingReturn(klines, 5)
    const return20 = trailingReturn(klines, 20)
    const return60 = trailingReturn(klines, 60)
    const volatility = realizedVolatility(klines)

    return {
      ...contract,
      ok: true,
      quote,
      metrics: {
        return5,
        return20,
        return60,
        volatility,
      },
      trendScore: trendScoreFromReturns(return20, return60),
      riskScore: riskScoreFromVolatility(volatility),
      // 保留近一年（约 280 个交易日）的 K 线，月度走势图需要月末数据
      klines: klines.slice(-280),
    }
  } catch (error) {
    if (hasUsableValue(fallbackDriver)) {
      return {
        ...fallbackDriver,
        fallback: true,
        error: summarizeError(error),
      }
    }

    return {
      ...contract,
      ok: false,
      fallback: false,
      error: summarizeError(error),
    }
  }
}

async function main() {
  const previousSnapshot = await readJsonFile(outputPath, null)
  const fundTrendFallback =
    previousSnapshot?.nav || previousSnapshot?.navTrend || previousSnapshot?.performance
      ? {
          nav: previousSnapshot.nav,
          navTrend: previousSnapshot.navTrend,
          performance: previousSnapshot.performance,
        }
      : null

  const coreSources = [
    {
      id: 'quote',
      label: sourceLabels.quote,
      required: true,
      url: quoteUrl,
      parse: parseQuote,
      fallback: previousSnapshot?.quote,
      attempts: 1,
      timeoutMs: 10000,
    },
    {
      id: 'etfKlines',
      label: sourceLabels.etfKlines,
      required: true,
      url: etfKlineUrl,
      parse: parseKlines,
      fallback: previousSnapshot?.etfKlines,
      attempts: 1,
      timeoutMs: 10000,
    },
    {
      id: 'benchmarkKlines',
      label: sourceLabels.benchmarkKlines,
      required: true,
      url: benchmarkKlineUrl,
      parse: parseKlines,
      fallback: previousSnapshot?.benchmarkKlines,
      attempts: 1,
      timeoutMs: 10000,
    },
    {
      id: 'fundGauge',
      label: sourceLabels.fundGauge,
      required: false,
      url: fundGaugeUrl,
      parse: parseFundGauge,
      fallback: previousSnapshot?.estimate,
      attempts: 1,
      timeoutMs: 6000,
    },
    {
      id: 'fundTrend',
      label: sourceLabels.fundTrend,
      required: true,
      url: fundTrendUrl,
      parse: parseFundTrend,
      fallback: fundTrendFallback,
      attempts: 1,
      timeoutMs: 10000,
    },
  ]

  // 限制并发，避免一次性向东方财富/天天基金抛过多请求触发风控
  const sourceResults = await runLimited(coreSources, 5, fetchParsedSource)
  const sourceById = new Map(sourceResults.map((result) => [result.id, result]))
  const missingRequired = sourceResults.filter(
    (result) =>
      coreSources.find((source) => source.id === result.id)?.required &&
      !hasUsableValue(result.value),
  )

  if (missingRequired.length > 0) {
    throw new Error(
      `核心数据源不可用且无缓存：${missingRequired
        .map((result) => result.health.label)
        .join('、')}`,
    )
  }

  const previousDriversByKey = new Map(
    (previousSnapshot?.commodityDrivers ?? []).map((driver) => [driver.key, driver]),
  )
  const commodityDrivers = await runLimited(commodityContracts, 2, (contract) =>
    fetchCommodityDriver(contract, previousDriversByKey.get(contract.key)),
  )
  const commodityOkCount = commodityDrivers.filter((item) => item.ok).length
  const commodityFallbackCount = commodityDrivers.filter((item) => item.fallback).length
  const commodityHealth = {
    id: 'commodityDrivers',
    label: sourceLabels.commodityDrivers,
    required: false,
    ok: commodityOkCount >= 3 && commodityFallbackCount === 0,
    fallback: commodityFallbackCount > 0,
    fetchedAt: new Date().toISOString(),
    okCount: commodityOkCount,
    total: commodityDrivers.length,
    fallbackCount: commodityFallbackCount,
    error:
      commodityOkCount < 3
        ? '可用商品驱动少于 3 个'
        : commodityFallbackCount > 0
          ? `使用 ${commodityFallbackCount} 个缓存商品驱动`
          : undefined,
  }

  const quote = sourceById.get('quote').value
  const etfKlines = sourceById.get('etfKlines').value
  const benchmarkKlines = sourceById.get('benchmarkKlines').value
  const estimate = sourceById.get('fundGauge').value
  const { nav, navTrend, performance } = sourceById.get('fundTrend').value
  const sourceHealthList = [...sourceResults.map((result) => result.health), commodityHealth]
  const hasSourceDegradation = sourceHealthList.some((source) => !source.ok)
  const hasRequiredDegradation = sourceHealthList.some((source) => source.required && !source.ok)

  const snapshotDraft = {
    meta: {
      generatedAt: new Date().toISOString(),
      mode: hasRequiredDegradation ? 'degraded' : hasSourceDegradation ? 'partial' : 'refreshed',
      sources: [
        'push2.eastmoney.com quote api',
        'push2his.eastmoney.com 512400 adjusted kline api',
        'push2his.eastmoney.com 000819 benchmark kline api',
        'push2.eastmoney.com futures/index quote api',
        'push2his.eastmoney.com futures/index kline api',
        'fund.eastmoney.com pingzhongdata',
        'fundgz.1234567.com.cn estimated net value',
      ],
      sourceHealth: sourceHealthList,
    },
    quote,
    nav,
    navTrend,
    estimate,
    performance,
    etfKlines,
    benchmarkKlines,
    commodityDrivers,
  }
  const history = await writeSnapshotHistory(snapshotDraft)
  const snapshot = {
    ...snapshotDraft,
    history,
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${outputPath}`)
  console.log(
    [
      `${quote.code} ${quote.name}`,
      `price=${quote.price}`,
      `nav=${nav?.unit ?? 'n/a'}`,
      `klines=${etfKlines.length}`,
      `benchmark=${benchmarkKlines.length}`,
      `drivers=${commodityDrivers.filter((item) => item.ok).length}/${commodityDrivers.length}`,
      `mode=${snapshot.meta.mode}`,
      `history=${history.count}`,
      `tradeDate=${quote.tradeDate}`,
      `generatedAt=${snapshot.meta.generatedAt}`,
    ].join(' | '),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
