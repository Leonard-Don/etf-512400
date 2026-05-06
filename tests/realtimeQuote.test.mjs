import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRealtimeKline,
  parseRealtimeQuote,
} from '../src/analysis/realtimeQuote.js'

const EASTMONEY_SAMPLE = {
  rc: 0,
  rt: 17,
  svr: 182481332,
  lt: 1,
  full: 1,
  data: {
    f43: 2195,
    f44: 2199,
    f45: 2118,
    f46: 2121,
    f47: 1725812,
    f48: 374960891,
    f50: 0,
    f57: '512400',
    f58: '有色金属ETF',
    f59: 3,
    f60: 2119,
    f71: 2172,
    f86: 1778049199,
    f116: 8438067344,
    f117: 0,
    f168: 423,
    f169: 76,
    f170: 359,
    f171: 382,
    f292: 5,
  },
}

test('parseRealtimeQuote 标准化 Eastmoney 运行时行情', () => {
  const quote = parseRealtimeQuote(JSON.stringify(EASTMONEY_SAMPLE))

  assert.equal(quote.code, '512400')
  assert.equal(quote.name, '有色金属ETF')
  assert.equal(quote.tradeDate, '2026-05-06')
  assert.equal(quote.tradeTime, '2026-05-06 14:33:19')
  assert.equal(quote.price, 2.195)
  assert.equal(quote.previousClose, 2.119)
  assert.equal(quote.open, 2.121)
  assert.equal(quote.high, 2.199)
  assert.equal(quote.low, 2.118)
  assert.equal(quote.averagePrice, 2.172)
  assert.equal(quote.change, 0.076)
  assert.equal(quote.changePercent, 0.0359)
  assert.equal(quote.turnoverRate, 0.0423)
  assert.equal(quote.amountCny, 374960891)
  assert.equal(quote.volumeLots, 1725812)
  assert.equal(quote.statusCode, 5)
  assert.equal(quote.source, 'eastmoney-runtime')
})

test('parseRealtimeQuote 拒绝缺失核心价格的载荷', () => {
  assert.throws(
    () =>
      parseRealtimeQuote({
        rc: 0,
        data: {
          ...EASTMONEY_SAMPLE.data,
          f43: '-',
        },
      }),
    /missing code, price, or previous close/,
  )
})

test('parseRealtimeQuote 拒绝非成功状态载荷', () => {
  assert.throws(() => parseRealtimeQuote({ rc: 102, data: null }), /rc=102/)
})

test('parseRealtimeKline 使用当日 K 线作为浏览器实时兜底', () => {
  const quote = parseRealtimeKline(
    {
      rc: 0,
      data: {
        code: '512400',
        market: 1,
        name: '有色金属ETF南方',
        decimal: 3,
        preKPrice: 2.119,
        klines: ['2026-05-06,2.134,2.197,2.199,2.114,6277464,1357180173.000,4.01,3.68,0.078,4.75'],
      },
    },
    new Date('2026-05-06T06:45:02Z'),
  )

  assert.equal(quote.code, '512400')
  assert.equal(quote.name, '有色金属ETF南方')
  assert.equal(quote.tradeDate, '2026-05-06')
  assert.equal(quote.tradeTime, '2026-05-06 14:45:02')
  assert.equal(quote.price, 2.197)
  assert.equal(quote.previousClose, 2.119)
  assert.equal(quote.change, 0.078)
  assert.equal(quote.changePercent, 0.0368)
  assert.equal(quote.turnoverRate, 0.0475)
  assert.equal(quote.amountCny, 1357180173)
  assert.equal(quote.volumeLots, 6277464)
  assert.equal(quote.source, 'eastmoney-kline-runtime')
})
