import { afterEach, describe, expect, test, vi } from 'vitest'
import { Component } from 'react'
import { ErrorBoundary } from '../src/components/ErrorBoundary.jsx'
import { render } from './helpers/render.jsx'

class Boom extends Component {
  render() {
    throw new Error('boom')
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  test('children render unchanged when no error', () => {
    const { html, unmount } = render(
      <ErrorBoundary label="测试">
        <div>正常内容</div>
      </ErrorBoundary>,
    )
    expect(html()).toContain('正常内容')
    expect(html()).not.toContain('渲染异常')
    unmount()
  })

  test('render-time throw is caught and fallback uses the label', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { html, unmount } = render(
      <ErrorBoundary label="决策台">
        <Boom />
      </ErrorBoundary>,
    )
    expect(html()).toContain('决策台渲染异常')
    expect(html()).toContain('boom')
    unmount()
  })

  test('custom fallback render prop receives error and reset', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fallback = vi.fn(({ error }) => <span>{`自定义: ${error.message}`}</span>)
    const { html, unmount } = render(
      <ErrorBoundary fallback={fallback}>
        <Boom />
      </ErrorBoundary>,
    )
    expect(html()).toContain('自定义: boom')
    expect(fallback).toHaveBeenCalled()
    const arg = fallback.mock.calls[0][0]
    expect(arg.error).toBeInstanceOf(Error)
    expect(typeof arg.reset).toBe('function')
    unmount()
  })

  test('boundary defaults the label when not provided', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { html, unmount } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(html()).toContain('当前面板渲染异常')
    unmount()
  })
})
