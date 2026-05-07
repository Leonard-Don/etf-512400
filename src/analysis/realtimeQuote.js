export const REALTIME_QUOTE_URL =
  'https://push2.eastmoney.com/api/qt/stock/get?secid=1.512400&fields=f43,f44,f45,f46,f47,f48,f50,f57,f58,f59,f60,f71,f86,f116,f117,f168,f169,f170,f171,f292'
export const REALTIME_KLINE_URL =
  'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.512400&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&lmt=1&end=20500101'
export const REALTIME_TENCENT_URL =
  'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh512400,day,,,1,qfq'
export const LOCAL_REALTIME_QUOTE_URL = '/api/realtime/quote'
export const LOCAL_REALTIME_KLINE_URL = '/api/realtime/kline'
export const LOCAL_REALTIME_TENCENT_URL = '/api/realtime/tencent'

export function priceFromQuote(value, decimals) {
  if (typeof value !== 'number' || value <= 0) return null
  if (Number.isInteger(decimals) && decimals >= 0) {
    return Number((value / 10 ** decimals).toFixed(Math.min(decimals, 4)))
  }
  return Number((value / 1000).toFixed(4))
}

export function percentFromEastmoney(value) {
  if (typeof value !== 'number') return null
  return Number((value / 10000).toFixed(4))
}

function numberFromKline(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  if (!normalized) {
    return null
  }
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function positiveNumberFromKline(value) {
  const number = numberFromKline(value)
  return number !== null && number > 0 ? number : null
}

function percentFromKline(value) {
  const number = numberFromKline(value)
  return number === null ? null : Number((number / 100).toFixed(4))
}

function parseTencentClock(value) {
  if (!value || typeof value !== 'string' || value.length < 14) {
    return { date: null, time: null }
  }
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  return {
    date,
    time: `${date} ${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`,
  }
}

export function shanghaiDateTimeFromDate(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    return { date: null, time: null }
  }
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
  return {
    date: day,
    time: `${day} ${read('hour')}:${read('minute')}:${read('second')}`,
  }
}

export function shanghaiDateTimeFromEpoch(seconds) {
  if (!seconds) return { date: null, time: null }
  return shanghaiDateTimeFromDate(new Date(seconds * 1000))
}

export function parseRealtimeQuote(payloadOrText) {
  const payload =
    typeof payloadOrText === 'string' ? JSON.parse(payloadOrText) : payloadOrText

  if (payload?.rc !== 0 || !payload.data) {
    throw new Error(`Unexpected realtime quote payload rc=${payload?.rc ?? 'null'}`)
  }

  const data = payload.data
  const tradeClock = shanghaiDateTimeFromEpoch(data.f86)
  const price = priceFromQuote(data.f43, data.f59)
  const previousClose = priceFromQuote(data.f60, data.f59)

  if (!data.f57 || price === null || previousClose === null) {
    throw new Error('Realtime quote missing code, price, or previous close')
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
    change:
      price !== null && previousClose !== null
        ? Number((price - previousClose).toFixed(4))
        : null,
    changePercent: percentFromEastmoney(data.f170),
    amountCny: data.f48,
    volumeLots: data.f47,
    turnoverRate: percentFromEastmoney(data.f168),
    statusCode: data.f292,
    totalMarketValueCny: data.f116,
    source: 'eastmoney-runtime',
  }
}

export function parseRealtimeKline(payloadOrText, fetchedAt = new Date()) {
  const payload =
    typeof payloadOrText === 'string' ? JSON.parse(payloadOrText) : payloadOrText

  if (payload?.rc !== 0 || !payload.data?.klines?.length) {
    throw new Error(`Unexpected realtime kline payload rc=${payload?.rc ?? 'null'}`)
  }

  const data = payload.data
  const line = data.klines.at(-1)
  const [
    tradeDate,
    open,
    close,
    high,
    low,
    volume,
    amount,
    amplitude,
    changePercent,
    change,
    turnoverRate,
  ] = line.split(',')
  const price = positiveNumberFromKline(close)
  const previousClose = positiveNumberFromKline(data.preKPrice)
  const fetchedClock = shanghaiDateTimeFromDate(fetchedAt)

  if (!data.code || !tradeDate || price === null || previousClose === null) {
    throw new Error('Realtime kline missing code, date, price, or previous close')
  }

  return {
    code: data.code,
    name: data.name,
    tradeDate,
    tradeTime: fetchedClock.time,
    price,
    previousClose,
    open: numberFromKline(open),
    high: numberFromKline(high),
    low: numberFromKline(low),
    averagePrice: null,
    change: numberFromKline(change),
    changePercent: percentFromKline(changePercent),
    amountCny: numberFromKline(amount),
    volumeLots: numberFromKline(volume),
    amplitude: percentFromKline(amplitude),
    turnoverRate: percentFromKline(turnoverRate),
    statusCode: 5,
    totalMarketValueCny: null,
    source: 'eastmoney-kline-runtime',
  }
}

export function parseRealtimeTencent(payloadOrText) {
  const payload =
    typeof payloadOrText === 'string' ? JSON.parse(payloadOrText) : payloadOrText
  const quote = payload?.data?.sh512400?.qt?.sh512400

  if (!Array.isArray(quote)) {
    throw new Error('Unexpected realtime Tencent payload')
  }

  const tradeClock = parseTencentClock(quote[30])
  const quoteTuple = typeof quote[35] === 'string' ? quote[35].split('/') : []
  const price = positiveNumberFromKline(quote[3])
  const previousClose = positiveNumberFromKline(quote[4])
  const amountFromTuple = numberFromKline(quoteTuple[2])
  const amountInTenThousand = numberFromKline(quote[57])
  const amountCny =
    amountFromTuple ?? (amountInTenThousand === null ? null : amountInTenThousand * 10000)

  if (!quote[2] || price === null || previousClose === null) {
    throw new Error('Realtime Tencent quote missing code, price, or previous close')
  }

  return {
    code: quote[2],
    name: quote[1],
    tradeDate: tradeClock.date,
    tradeTime: tradeClock.time,
    price,
    previousClose,
    open: numberFromKline(quote[5]),
    high: numberFromKline(quote[33]),
    low: numberFromKline(quote[34]),
    averagePrice: numberFromKline(quote[88]),
    change: numberFromKline(quote[31]),
    changePercent: percentFromKline(quote[32]),
    amountCny,
    volumeLots: numberFromKline(quote[36]),
    amplitude: percentFromKline(quote[43]),
    turnoverRate: percentFromKline(quote[38]),
    statusCode: 5,
    totalMarketValueCny: numberFromKline(quote[73]),
    source: 'tencent-runtime',
  }
}
