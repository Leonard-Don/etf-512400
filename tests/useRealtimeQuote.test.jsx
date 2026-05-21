import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { useRealtimeQuote } from '../src/hooks/useRealtimeQuote.js'
import { render } from './helpers/render.jsx'

// useRealtimeQuote 是项目里唯一的有状态异步 hook：顺序探测多个 endpoint、拿到第一份
// 可解析行情就停、按固定间隔轮询、并用 cancelled flag 防止卸载后迟到的 fetch 写回 state。
// 这些都用 fake timer + 受控 fetch mock 覆盖。常量镜像自 useRealtimeQuote.js（未导出）。
const REFRESH_MS = 30000
const TIMEOUT_MS = 8000

// 只暴露 hook 真正消费的字段：.ok / .status / .text()。
const okResponse = (body = 'BODY') => ({ ok: true, status: 200, text: async () => body })
const httpError = (status = 500) => ({ ok: false, status, text: async () => '' })

const abortError = () => {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

// 形状对齐 App.jsx 的 realtimeEndpoints 条目：{ id, label, url, parse }。
function endpoint(id) {
  return {
    id,
    label: `${id}-源`,
    url: `https://test.local/${id}`,
    parse: (text) => ({ priceText: text, parsedBy: id }),
  }
}

function deferred() {
  let resolve
  const promise = new Promise((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// 把 hook 的 state 序列化进 DOM，测试侧再读回来——不依赖 testing-library。
function Probe({ endpoints }) {
  const state = useRealtimeQuote(endpoints)
  return <pre>{JSON.stringify(state)}</pre>
}

function mountHook(endpoints) {
  const handle = render(<Probe endpoints={endpoints} />)
  return {
    ...handle,
    state: () => JSON.parse(handle.container.querySelector('pre').textContent),
  }
}

// 排空 fetch/text/parse 的 microtask 链并 flush React。fake timer 不影响 microtask。
async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve()
    }
  })
}

// 推进 fake timer（触发轮询 / 超时），再排空随之产生的 microtask 链。
async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve()
    }
  })
}

let fetchMock

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useRealtimeQuote', () => {
  test('initial fetch success populates the quote with runtime source and ISO timestamp', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('PRICE-A'))
    const hook = mountHook([endpoint('quote')])

    // 第一轮还没拿到 quote → loading（而不是 refreshing）。
    expect(hook.state().status).toBe('loading')

    await settle()

    const s = hook.state()
    expect(s.status).toBe('success')
    expect(s.quote).toMatchObject({
      priceText: 'PRICE-A',
      parsedBy: 'quote',
      runtimeSource: 'quote',
      runtimeSourceLabel: 'quote-源',
    })
    expect(s.error).toBeNull()
    expect(s.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://test.local/quote',
      expect.objectContaining({ signal: expect.anything() }),
    )
    hook.unmount()
  })

  test('falls back to the next endpoint when one returns a non-ok response', async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(503))
      .mockResolvedValueOnce(okResponse('FROM-BACKUP'))
    const hook = mountHook([endpoint('primary'), endpoint('backup')])

    await settle()

    const s = hook.state()
    expect(s.status).toBe('success')
    expect(s.quote.runtimeSource).toBe('backup')
    expect(s.quote.priceText).toBe('FROM-BACKUP')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    hook.unmount()
  })

  test('falls back to the next endpoint when fetch rejects', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(okResponse('FROM-BACKUP'))
    const hook = mountHook([endpoint('primary'), endpoint('backup')])

    await settle()

    const s = hook.state()
    expect(s.status).toBe('success')
    expect(s.quote.runtimeSource).toBe('backup')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    hook.unmount()
  })

  test('reports an error when every endpoint fails', async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(500))
      .mockRejectedValueOnce(new Error('tencent unreachable'))
    const hook = mountHook([endpoint('primary'), endpoint('backup')])

    await settle()

    const s = hook.state()
    expect(s.status).toBe('error')
    expect(s.quote).toBeNull()
    expect(s.error).toBe('tencent unreachable')
    hook.unmount()
  })

  test('polls again after the refresh interval and surfaces the refreshing status', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('CYCLE-1'))
    const secondCycle = deferred()
    fetchMock.mockReturnValueOnce(secondCycle.promise)
    const hook = mountHook([endpoint('quote')])

    await settle()
    expect(hook.state().status).toBe('success')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 轮询定时器触发第二轮：先 setState('refreshing')，再 await fetch。
    await advance(REFRESH_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(hook.state().status).toBe('refreshing')
    expect(hook.state().quote.priceText).toBe('CYCLE-1')

    secondCycle.resolve(okResponse('CYCLE-2'))
    await settle()
    expect(hook.state().status).toBe('success')
    expect(hook.state().quote.priceText).toBe('CYCLE-2')
    hook.unmount()
  })

  test('stops polling after unmount', async () => {
    fetchMock.mockResolvedValue(okResponse('X'))
    const hook = mountHook([endpoint('quote')])

    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    hook.unmount()
    await advance(REFRESH_MS * 5)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('a fetch resolving after unmount neither updates state nor reschedules a poll', async () => {
    const inFlight = deferred()
    fetchMock.mockReturnValueOnce(inFlight.promise)
    const hook = mountHook([endpoint('quote')])

    expect(hook.state().status).toBe('loading')
    hook.unmount()

    // fetch 在卸载之后才 resolve —— cancelled flag 必须挡住 setState 和重排轮询。
    inFlight.resolve(okResponse('LATE'))
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await advance(REFRESH_MS * 2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('aborts an endpoint that exceeds the timeout and falls through to the next', async () => {
    fetchMock.mockImplementationOnce(
      (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(abortError()))
        }),
    )
    fetchMock.mockResolvedValueOnce(okResponse('FROM-BACKUP'))
    const hook = mountHook([endpoint('slow'), endpoint('backup')])

    // 超时窗口内：slow 还挂着，hook 停在 loading。
    await settle()
    expect(hook.state().status).toBe('loading')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 推进过 TIMEOUT_MS → AbortController 触发 → slow 被拒 → 落到 backup。
    await advance(TIMEOUT_MS)
    await settle()

    const s = hook.state()
    expect(s.status).toBe('success')
    expect(s.quote.runtimeSource).toBe('backup')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    hook.unmount()
  })
})
