import { useEffect, useState } from 'react'

const REFRESH_MS = 30000
const TIMEOUT_MS = 8000

// 顺序尝试 endpoints 直到拿到一份可解析的实时行情；任一成功就停止，并按 REFRESH_MS 重试。
// endpoints 必须是稳定引用（建议放在 module scope 或用 useMemo），否则会反复重置定时器。
export function useRealtimeQuote(endpoints) {
  const [state, setState] = useState({
    status: 'idle',
    quote: null,
    lastUpdated: null,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    let timer = null

    async function fetchEndpoint(endpoint) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

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

    async function refresh() {
      setState((current) => ({
        ...current,
        status: current.quote ? 'refreshing' : 'loading',
        error: null,
      }))

      try {
        let result = null
        let lastError = null

        for (const endpoint of endpoints) {
          try {
            result = await fetchEndpoint(endpoint)
            break
          } catch (error) {
            lastError = error
          }
        }

        if (!result) {
          throw lastError ?? new Error('实时行情请求失败')
        }
        if (!cancelled) {
          setState({
            status: 'success',
            quote: result.quote,
            lastUpdated: result.fetchedAt.toISOString(),
            error: null,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            status: 'error',
            error: error.message,
          }))
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(refresh, REFRESH_MS)
        }
      }
    }

    refresh()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [endpoints])

  return state
}
