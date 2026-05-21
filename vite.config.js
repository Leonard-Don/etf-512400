import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import {
  REALTIME_KLINE_URL,
  REALTIME_QUOTE_URL,
  REALTIME_TENCENT_URL,
} from './src/analysis/realtimeQuote.js'

const execFileAsync = promisify(execFile)
const marketHeaders = {
  accept: 'application/json,*/*',
  'user-agent': 'Mozilla/5.0',
}

function writeJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

async function fetchWithCurl(url) {
  const { stdout } = await execFileAsync(
    'curl',
    ['--http1.1', '-sS', '--max-time', '8', '-A', marketHeaders['user-agent'], url],
    { maxBuffer: 1024 * 1024 },
  )
  return stdout
}

async function fetchMarketText(url) {
  try {
    const response = await fetch(url, { headers: marketHeaders })
    const text = await response.text()

    if (!response.ok) {
      throw new Error(`Upstream market request failed ${response.status}`)
    }
    return text
  } catch {
    return fetchWithCurl(url)
  }
}

async function proxyMarketJson(res, url) {
  try {
    const text = await fetchMarketText(url)

    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  } catch (error) {
    console.error(`[etf-realtime-proxy] upstream request failed: ${url}`, error.message)
    writeJson(res, 502, {
      rc: 502,
      error: '行情代理请求失败',
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
      server.middlewares.use('/api/realtime/tencent', (_req, res) =>
        proxyMarketJson(res, REALTIME_TENCENT_URL),
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), realtimeProxyPlugin()],
})
