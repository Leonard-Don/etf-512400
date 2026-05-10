import { describe, expect, test } from 'vitest'
import { CommodityDriverPanel } from '../src/components/MarketPanels.jsx'
import { render } from './helpers/render.jsx'

describe('CommodityDriverPanel return5/20/60 display', () => {
  test('null/undefined return5/20/60 render formatter fallback, not 0.0%', () => {
    // 上游商品 driver 的 return5/20/60 在 JSON 反序列化（NaN/Infinity → null）、
    // schema 漂移、或字段未填时会以 null/undefined 形态到达。共享 formatter 已锁
    // 死 numeric-primitive-only（PR #27-#30），但 MarketPanels 调用点用 `?? 0`
    // 兜底，会把缺失语义伪装成合法 0.0%，与 numeric 0 同形——必须移除 ?? 0 让
    // formatter 自己走 暂无 fallback。
    const drivers = [{
      key: 'gold',
      label: '黄金',
      source: 'CME',
      unit: 'USD/oz',
      price: 2400,
      changePercent: 0.012,
      trendScore: 50,
      riskScore: 30,
      return5: null,
      return20: undefined,
      return60: Number.NaN,
    }]
    const { html, unmount } = render(<CommodityDriverPanel commodityDrivers={drivers} />)
    const out = html()
    const fallbackCount = (out.match(/暂无/g) || []).length
    expect(fallbackCount).toBe(3)
    expect(out).not.toMatch(/<dd>0\.0%<\/dd>/)
    unmount()
  })

  test('numeric 0 return5/20/60 still render as 0.0% (regression guard)', () => {
    const drivers = [{
      key: 'copper',
      label: '铜',
      source: 'LME',
      unit: 'USD/t',
      price: 9000,
      changePercent: 0.005,
      trendScore: 40,
      riskScore: 25,
      return5: 0,
      return20: 0,
      return60: 0,
    }]
    const { html, unmount } = render(<CommodityDriverPanel commodityDrivers={drivers} />)
    const out = html()
    const zeroCellCount = (out.match(/<dd>0\.0%<\/dd>/g) || []).length
    expect(zeroCellCount).toBe(3)
    expect(out).not.toContain('暂无')
    unmount()
  })
})
