import { describe, expect, test } from 'vitest'
import { CommodityDriverPanel, MiniLineChart, RiskStack } from '../src/components/MarketPanels.jsx'
import { render } from './helpers/render.jsx'

describe('MiniLineChart indexed display', () => {
  test('renders a shared common-period indexed chart without leaking non-finite values', () => {
    const trendSeries = [
      { date: '2025-12', etf: 1.8 },
      { date: '2026-01', etf: 2, gold: 10, copper: 5, rareEarth: 4 },
      { date: '2026-02', etf: 2.2, gold: Number.NaN, copper: 5.5, rareEarth: null },
      { date: '2026-03', etf: 2.4, gold: 12, copper: 4, rareEarth: 6 },
    ]
    const { container, html, unmount } = render(<MiniLineChart trendSeries={trendSeries} />)
    const out = html()
    const chart = container.querySelector('[aria-label="ETF与因子走势"]')
    expect(chart).toBeTruthy()
    expect(out).toContain('基准 100')
    expect(out).not.toContain('2025-12')
    expect(out).toContain('2026-01')
    expect(out).toContain('2026-03')
    expect(out).toContain('+20.0%')
    expect(out).toContain('-20.0%')
    expect(out).not.toMatch(/NaN|Infinity|undefined|null/)
    unmount()
  })
})

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

describe('CommodityDriverPanel changePercent display', () => {
  test('null/undefined/NaN changePercent render formatter fallback, not 0.0%', () => {
    const drivers = [null, undefined, Number.NaN].map((changePercent, index) => ({
      key: `driver-${index}`,
      label: `商品${index}`,
      source: 'TEST',
      unit: 'unit',
      price: 100 + index,
      changePercent,
      trendScore: 50,
      riskScore: 30,
      return5: 0.01,
      return20: 0.02,
      return60: 0.03,
    }))
    const { html, unmount } = render(<CommodityDriverPanel commodityDrivers={drivers} />)
    const out = html()
    const fallbackCount = (out.match(/暂无/g) || []).length
    expect(fallbackCount).toBe(3)
    expect(out).not.toMatch(/<span class="(?:positive|negative|neutral)">0\.0%<\/span>/)
    unmount()
  })

  test('numeric 0 changePercent still renders as a real 0%', () => {
    const drivers = [{
      key: 'silver',
      label: '白银',
      source: 'CME',
      unit: 'USD/oz',
      price: 30,
      changePercent: 0,
      trendScore: 45,
      riskScore: 20,
      return5: 0.01,
      return20: 0.02,
      return60: 0.03,
    }]
    const { html, unmount } = render(<CommodityDriverPanel commodityDrivers={drivers} />)
    const out = html()
    expect(out).toContain('0.00%')
    expect(out).not.toContain('暂无')
    unmount()
  })
})

describe('CommodityDriverPanel international references', () => {
  test('renders international commodity data beside the domestic driver', () => {
    const drivers = [{
      key: 'gold',
      label: '沪金主连',
      source: 'SHFE',
      unit: '元/克',
      price: 1041.54,
      changePercent: 0.0059,
      trendScore: 37,
      riskScore: 95,
      return5: 0.019,
      return20: 0.007,
      return60: -0.103,
      international: {
        label: 'COMEX黄金',
        source: 'COMEX',
        unit: '美元/盎司',
        price: 4544.4,
        changePercent: -0.003,
      },
    }]
    const { html, unmount } = render(<CommodityDriverPanel commodityDrivers={drivers} />)
    const out = html()
    expect(out).toContain('国际参照')
    expect(out).toContain('COMEX黄金')
    expect(out).toContain('美元/盎司')
    expect(out).toContain('4,544.40')
    expect(out).toContain('-0.30%')
    expect(out).toContain('内盘日涨跌')
    expect(out).toContain('外盘日涨跌')
    expect(out).toContain('背离')
    unmount()
  })
})

describe('CommodityDriverPanel driver score meters', () => {
  // 上游 driver.trendScore/riskScore 在 schema 漂移、回测样本不足、或 JSON
  // 反序列化（NaN/Infinity → null）时会以 null/undefined/NaN 形态到达。原实现
  // `driver.trendScore ?? 0` 把缺失伪装成合法 0（与真实 0 同形），且 NaN 不会
  // 被 `??` 兜底，会原样漏到 Meter，最终渲染出 `width: NaN%` 和 `<b>NaN</b>`。
  // 守卫后：缺失/非有限值走 暂无 + 0% 宽度；真实 0 仍渲染 0 + 0%。
  function makeDriver(overrides) {
    return {
      key: 'gold',
      label: '黄金',
      source: 'CME',
      unit: 'USD/oz',
      price: 2400,
      changePercent: 0.012,
      trendScore: 50,
      riskScore: 30,
      return5: 0.01,
      return20: 0.02,
      return60: 0.03,
      ...overrides,
    }
  }

  test('null/undefined/NaN trendScore renders 暂无 with safe 0% width', () => {
    const drivers = [
      makeDriver({ key: 'd-null', trendScore: null }),
      makeDriver({ key: 'd-undef', trendScore: undefined }),
      makeDriver({ key: 'd-nan', trendScore: Number.NaN }),
    ]
    const { container, html, unmount } = render(<CommodityDriverPanel commodityDrivers={drivers} />)
    const out = html()
    expect(out).not.toMatch(/NaN|undefined|null/)
    const trendBars = Array.from(container.querySelectorAll('.driver-scores .meter:first-child i'))
    expect(trendBars).toHaveLength(3)
    for (const bar of trendBars) {
      expect(bar.style.width).toBe('0%')
    }
    const trendValues = Array.from(container.querySelectorAll('.driver-scores .meter:first-child b'))
    for (const node of trendValues) {
      expect(node.textContent).toBe('暂无')
    }
    unmount()
  })

  test('null/undefined/NaN riskScore renders 暂无 with safe 0% width', () => {
    const drivers = [
      makeDriver({ key: 'd-null', riskScore: null }),
      makeDriver({ key: 'd-undef', riskScore: undefined }),
      makeDriver({ key: 'd-nan', riskScore: Number.NaN }),
    ]
    const { container, html, unmount } = render(<CommodityDriverPanel commodityDrivers={drivers} />)
    const out = html()
    expect(out).not.toMatch(/NaN|undefined|null/)
    const riskBars = Array.from(container.querySelectorAll('.driver-scores .meter:last-child i'))
    expect(riskBars).toHaveLength(3)
    for (const bar of riskBars) {
      expect(bar.style.width).toBe('0%')
    }
    const riskValues = Array.from(container.querySelectorAll('.driver-scores .meter:last-child b'))
    for (const node of riskValues) {
      expect(node.textContent).toBe('暂无')
    }
    unmount()
  })

  test('numeric 0 driver scores still render as real 0 with 0% width (regression guard)', () => {
    const drivers = [makeDriver({ key: 'zero', trendScore: 0, riskScore: 0 })]
    const { container, html, unmount } = render(<CommodityDriverPanel commodityDrivers={drivers} />)
    const out = html()
    expect(out).not.toContain('暂无')
    const trendBar = container.querySelector('.driver-scores .meter:first-child i')
    const riskBar = container.querySelector('.driver-scores .meter:last-child i')
    expect(trendBar.style.width).toBe('0%')
    expect(riskBar.style.width).toBe('0%')
    expect(container.querySelector('.driver-scores .meter:first-child b').textContent).toBe('0')
    expect(container.querySelector('.driver-scores .meter:last-child b').textContent).toBe('0')
    unmount()
  })

  test('finite driver scores render value text and scaled bar widths (regression guard)', () => {
    const drivers = [makeDriver({ key: 'ok', trendScore: 72, riskScore: 41 })]
    const { container, unmount } = render(<CommodityDriverPanel commodityDrivers={drivers} />)
    const trendBar = container.querySelector('.driver-scores .meter:first-child i')
    const riskBar = container.querySelector('.driver-scores .meter:last-child i')
    expect(trendBar.style.width).toBe('72%')
    expect(riskBar.style.width).toBe('41%')
    expect(container.querySelector('.driver-scores .meter:first-child b').textContent).toBe('72')
    expect(container.querySelector('.driver-scores .meter:last-child b').textContent).toBe('41')
    unmount()
  })
})

describe('RiskStack risk metrics display', () => {
  test('null/undefined/NaN risk metrics render formatter fallback, not 0.00%', () => {
    // riskMetrics 字段在 JSON 反序列化（NaN/Infinity → null）、上游 schema 漂移、
    // 或回测样本不足时会以 null/undefined/NaN 形态到达。原实现 `?? 0` 会把缺失伪装
    // 成合法 0.00%，而 crowdingScore/100 在 null 入参时通过 Number(null)=0 同样
    // 漏成 0.00%。守卫后必须三行都走 暂无，且条形宽度不能漏 NaN/undefined 到 CSS。
    const riskMetrics = {
      maxDrawdown: null,
      oneDayVar95: undefined,
      crowdingScore: Number.NaN,
    }
    const { container, html, unmount } = render(<RiskStack riskMetrics={riskMetrics} />)
    const out = html()
    const fallbackCount = (out.match(/暂无/g) || []).length
    expect(fallbackCount).toBe(3)
    expect(out).not.toMatch(/<strong>0\.00%<\/strong>/)
    const bars = Array.from(container.querySelectorAll('.risk-row i'))
    expect(bars).toHaveLength(3)
    for (const bar of bars) {
      expect(bar.style.width).toBe('0%')
    }
    expect(out).not.toMatch(/NaN|undefined|null/)
    unmount()
  })

  test('crowdingScore null specifically does not collapse to 0.00% via Number(null)/100', () => {
    // 回归保护：原实现里 crowdingScore=null → null/100=0 → formatPercent(0)='0.00%'，
    // 与合法 0 拥挤度同形。守卫后 null 必须走 暂无。
    const riskMetrics = {
      maxDrawdown: -0.12,
      oneDayVar95: 0.03,
      crowdingScore: null,
    }
    const { html, unmount } = render(<RiskStack riskMetrics={riskMetrics} />)
    const out = html()
    expect(out).toContain('暂无')
    expect((out.match(/暂无/g) || []).length).toBe(1)
    unmount()
  })

  test('numeric 0 risk metrics still render as real 0.00% (regression guard)', () => {
    const riskMetrics = {
      maxDrawdown: 0,
      oneDayVar95: 0,
      crowdingScore: 0,
    }
    const { container, html, unmount } = render(<RiskStack riskMetrics={riskMetrics} />)
    const out = html()
    const zeroCellCount = (out.match(/<strong>0\.00%<\/strong>/g) || []).length
    expect(zeroCellCount).toBe(3)
    expect(out).not.toContain('暂无')
    const bars = Array.from(container.querySelectorAll('.risk-row i'))
    for (const bar of bars) {
      expect(bar.style.width).toBe('0%')
    }
    unmount()
  })

  test('finite risk metrics render scaled bar widths and percent values', () => {
    const riskMetrics = {
      maxDrawdown: -0.18,
      oneDayVar95: 0.04,
      crowdingScore: 62,
    }
    const { container, html, unmount } = render(<RiskStack riskMetrics={riskMetrics} />)
    const out = html()
    expect(out).toContain('-18.00%')
    expect(out).toContain('4.00%')
    expect(out).toContain('62.00%')
    expect(out).not.toContain('暂无')
    const bars = Array.from(container.querySelectorAll('.risk-row i'))
    expect(bars[0].style.width).toBe('36%')
    expect(bars[1].style.width).toBe('40%')
    expect(bars[2].style.width).toBe('62%')
    unmount()
  })

  test('large finite risk metrics clamp bar widths to 100% but keep formatter percent text', () => {
    // 极端回撤/VaR/拥挤度（数据异常、压力情景或 schema 漂移）不能让 CSS width
    // 超过 100% 撑破容器；但 strong 文案仍应走 formatter 输出真实数字。
    // 当前 drawdown/var 已被 Math.min 夹到 100，crowdingScore 漏夹则会写入
    // width:150% 撑破 risk-row。
    const riskMetrics = {
      maxDrawdown: -0.6,
      oneDayVar95: 0.5,
      crowdingScore: 150,
    }
    const { container, html, unmount } = render(<RiskStack riskMetrics={riskMetrics} />)
    const out = html()
    const bars = Array.from(container.querySelectorAll('.risk-row i'))
    expect(bars[0].style.width).toBe('100%')
    expect(bars[1].style.width).toBe('100%')
    expect(bars[2].style.width).toBe('100%')
    expect(out).toContain('-60.00%')
    expect(out).toContain('50.00%')
    expect(out).toContain('150.00%')
    expect(out).not.toContain('暂无')
    unmount()
  })

  test('negative finite crowdingScore clamps bar width to 0% but keeps formatter percent text', () => {
    // 拥挤度漂到负数（归一化错误、上游输入污染）时 CSS width:-10% 是非法值，
    // 必须夹到 0%；strong 文案仍应使用 formatter 输出真实数字。
    const riskMetrics = {
      maxDrawdown: -0.18,
      oneDayVar95: 0.04,
      crowdingScore: -10,
    }
    const { container, html, unmount } = render(<RiskStack riskMetrics={riskMetrics} />)
    const out = html()
    const bars = Array.from(container.querySelectorAll('.risk-row i'))
    expect(bars[2].style.width).toBe('0%')
    expect(out).toContain('-10.00%')
    expect(out).not.toContain('暂无')
    unmount()
  })
})
