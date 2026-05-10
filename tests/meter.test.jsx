import { describe, expect, test } from 'vitest'
import { Meter } from '../src/components/ui.jsx'
import { render } from './helpers/render.jsx'

// Meter 已经守卫非有限值（null/undefined/NaN/Infinity）走 暂无 + 0% 宽度，
// 但是有限的越界值（如 -10、150）仍会被原样写入 CSS width，导致出现负宽度
// 或 >100% 宽度（视觉错位 / 撑破容器 / 与相邻条形重叠）。条形宽度必须夹到
// [0, 100]；显示的数值文案仍保留原始数字（例如 -10 / 150 应当原样显示在
// <b> 中），合法 0 仍渲染 0 + 0%；缺失/非有限仍走 暂无 + 0%。
describe('Meter bar width clamping', () => {
  test('negative finite value clamps width to 0% and keeps original value text', () => {
    const { container, unmount } = render(<Meter label="趋势" value={-10} color="#5f7f56" />)
    const bar = container.querySelector('i')
    const text = container.querySelector('b')
    expect(bar.style.width).toBe('0%')
    expect(text.textContent).toBe('-10')
    unmount()
  })

  test('finite value above 100 clamps width to 100% and keeps original value text', () => {
    const { container, unmount } = render(<Meter label="趋势" value={150} color="#5f7f56" />)
    const bar = container.querySelector('i')
    const text = container.querySelector('b')
    expect(bar.style.width).toBe('100%')
    expect(text.textContent).toBe('150')
    unmount()
  })

  test('numeric 0 still renders as real 0 with 0% width (regression guard)', () => {
    const { container, unmount } = render(<Meter label="趋势" value={0} color="#5f7f56" />)
    const bar = container.querySelector('i')
    const text = container.querySelector('b')
    expect(bar.style.width).toBe('0%')
    expect(text.textContent).toBe('0')
    unmount()
  })

  test('finite in-range value renders unchanged (regression guard)', () => {
    const { container, unmount } = render(<Meter label="趋势" value={62} color="#5f7f56" />)
    const bar = container.querySelector('i')
    const text = container.querySelector('b')
    expect(bar.style.width).toBe('62%')
    expect(text.textContent).toBe('62')
    unmount()
  })

  test('null and NaN render 暂无 with 0% width (regression guard)', () => {
    for (const value of [null, Number.NaN]) {
      const { container, html, unmount } = render(<Meter label="趋势" value={value} color="#5f7f56" />)
      const bar = container.querySelector('i')
      const text = container.querySelector('b')
      expect(bar.style.width).toBe('0%')
      expect(text.textContent).toBe('暂无')
      expect(html()).not.toMatch(/NaN|undefined|null/)
      unmount()
    }
  })
})
