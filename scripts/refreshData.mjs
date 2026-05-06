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
async function fetchText(url, { attempts = 3 } = {}) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: '*/*',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
        },
      })

      if (response.ok) return await response.text()

      const retryable = response.status === 429 || response.status >= 500
      const error = new Error(`Fetch failed ${response.status} ${url}`)
      if (!retryable) throw error
      lastError = error
    } catch (error) {
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

async function fetchCommodityDriver(contract) {
  try {
    const quoteRequest = fetchText(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=${contract.secid}&fields=${quoteFields}`,
    )
    const klineRequest = fetchText(
      `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${contract.secid}&klt=101&fqt=0&lmt=70&end=20500101&${klineFields}`,
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
      klines: klines.slice(-20),
    }
  } catch (error) {
    return {
      ...contract,
      ok: false,
      error: error.message,
    }
  }
}

async function main() {
  // 限制并发，避免一次性向东方财富/天天基金抛过多请求触发风控
  const [quoteText, etfKlineText, benchmarkKlineText, gaugeText, trendText] = await runLimited(
    [quoteUrl, etfKlineUrl, benchmarkKlineUrl, fundGaugeUrl, fundTrendUrl],
    4,
    (url) => fetchText(url),
  )
  const commodityDrivers = await runLimited(commodityContracts, 2, fetchCommodityDriver)

  const quote = parseQuote(quoteText)
  const etfKlines = parseKlines(etfKlineText)
  const benchmarkKlines = parseKlines(benchmarkKlineText)
  const estimate = parseFundGauge(gaugeText)
  const { nav, navTrend, performance } = parseFundTrend(trendText)

  const snapshotDraft = {
    meta: {
      generatedAt: new Date().toISOString(),
      mode: 'refreshed',
      sources: [
        'push2.eastmoney.com quote api',
        'push2his.eastmoney.com 512400 adjusted kline api',
        'push2his.eastmoney.com 000819 benchmark kline api',
        'push2.eastmoney.com futures/index quote api',
        'push2his.eastmoney.com futures/index kline api',
        'fund.eastmoney.com pingzhongdata',
        'fundgz.1234567.com.cn estimated net value',
      ],
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
