import { describe, expect, test } from 'vitest'
import { act } from 'react'
import { HoldingsTable } from '../src/components/HoldingsTable.jsx'
import { render } from './helpers/render.jsx'

// 三个权重不同的持仓；代码用单字母，便于断言排序后的行序。
const holdings = [
  { code: 'A', name: '甲源', basket: '黄金', weight: 5, signal: '弱' },
  { code: 'B', name: '乙源', basket: '铜', weight: 20, signal: '强' },
  { code: 'C', name: '丙源', basket: '铝', weight: 12, signal: '中' },
]

function codeOrder(container) {
  return [...container.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent)
}

function header(container, label) {
  return [...container.querySelectorAll('th')].find((th) => th.textContent.includes(label))
}

describe('HoldingsTable', () => {
  test('默认按权重降序渲染所有持仓行', () => {
    const { container, unmount } = render(<HoldingsTable holdings={holdings} />)
    expect(codeOrder(container)).toEqual(['B', 'C', 'A'])
    expect(header(container, '权重').getAttribute('aria-sort')).toBe('descending')
    unmount()
  })

  test('点击当前排序列翻转方向', () => {
    const { container, unmount } = render(<HoldingsTable holdings={holdings} />)
    act(() => {
      header(container, '权重').click()
    })
    expect(codeOrder(container)).toEqual(['A', 'C', 'B'])
    expect(header(container, '权重').getAttribute('aria-sort')).toBe('ascending')
    unmount()
  })

  test('点击其它列切换排序列，aria-sort 随之转移', () => {
    const { container, unmount } = render(<HoldingsTable holdings={holdings} />)
    act(() => {
      header(container, '信号').click()
    })
    expect(header(container, '信号').getAttribute('aria-sort')).toBe('ascending')
    expect(header(container, '权重').getAttribute('aria-sort')).toBe('none')
    unmount()
  })
})
