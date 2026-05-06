import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import {
  REALTIME_KLINE_URL,
  REALTIME_QUOTE_URL,
} from './src/analysis/realtimeQuote.js'

function writeJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

async function proxyMarketJson(res, url) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json,*/*',
        'user-agent': 'Mozilla/5.0',
      },
    })
    const text = await response.text()

    if (!response.ok) {
      writeJson(res, response.status, {
        rc: response.status,
        error: `Upstream market request failed ${response.status}`,
      })
      return
    }

    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  } catch (error) {
    writeJson(res, 502, {
      rc: 502,
      error: error.message,
    })
  }
}

function realtimeProxyPlugin() {
  return {
    name: 'etf-realtime-proxy',
    configureServer(server) {
      server.middlewares.use('/api/realtime/quote', (_req, res) =>
        proxyMarketJson(res, REALTIME_QUOTE_URL),
      )
      server.middlewares.use('/api/realtime/kline', (_req, res) =>
        proxyMarketJson(res, REALTIME_KLINE_URL),
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), realtimeProxyPlugin()],
})
