import { describe, expect, test } from 'vitest'
import { TradingQualityPanel } from '../src/components/QualityPanels.jsx'
import { render } from './helpers/render.jsx'

function makeQuality(overrides = {}) {
  return {
    action: '先查跟踪偏离',
    tone: 'warning',
    score: 23,
    tracking: {
      benchmarkName: '中证申万有色金属 000819',
      status: '偏离放大',
      score: 0,
      sampleSize: 274,
      basis: '净值',
      deviation60: 0.0932,
      trackingError60: 0.002,
      ...overrides.tracking,
    },
    premium: {
      status: '折价偏深',
      score: 0,
      currentPremium: -0.0288,
      zScore: -4.2,
      average20: -0.001,
      streakLabel: '1日折价',
      sampleSize: 120,
      ...overrides.premium,
    },
    liquidity: {
      status: '正常换手',
      score: 70,
      amountPercentile: 22,
      latestAmount: 813_000_000,
      amountRatio20: 0.77,
      turnoverRate: 0.0321,
      sampleSize: 120,
      ...overrides.liquidity,
    },
    watchPoints: ['跟踪口径采用净值，样本 274 日'],
  }
}

describe('TradingQualityPanel quality meters', () => {
  test('hero explains what 先查跟踪偏离 means before the user reads the meters', () => {
    const { container, unmount } = render(<TradingQualityPanel quality={makeQuality()} />)
    const hero = container.querySelector('.quality-hero')
    expect(hero.textContent).toContain('交易前检查')
    expect(hero.textContent).toContain('先查跟踪偏离')
    expect(hero.textContent).toContain('近60日相对基准偏离偏大')
    expect(hero.textContent).toContain('+9.32%')
    expect(hero.textContent).toContain('先确认不是跟踪误差或口径问题')
    expect(hero.textContent).toContain('先看净值口径、跟踪误差和基准走势')
    expect(hero.textContent).toContain('中证申万有色金属 000819')
    expect(hero.textContent).toContain('质量分')
    expect(hero.textContent).toContain('23')
    unmount()
  })

  test('zero tracking score is paired with the deviation reason', () => {
    const { container, unmount } = render(<TradingQualityPanel quality={makeQuality()} />)
    const text = container.textContent
    expect(text).toContain('跟踪')
    expect(text).toContain('偏离放大')
    expect(text).toContain('60日 +9.32%')
    expect(text).toContain('误差 0.2%')
    expect(text).toContain('折价偏深')
    expect(text).toContain('当前 -2.88%')
    expect(text).toContain('-4.20σ')
    expect(text).toContain('正常换手')
    expect(text).toContain('22分位')
    expect(text).toContain('0.77x')
    unmount()
  })

  test('missing tracking score remains explicit sample shortage instead of looking like real zero', () => {
    const { container, html, unmount } = render(
      <TradingQualityPanel
        quality={makeQuality({
          tracking: {
            status: '样本不足',
            score: null,
            sampleSize: 14,
            deviation60: null,
            trackingError60: null,
          },
        })}
      />,
    )
    const out = html()
    expect(out).not.toMatch(/NaN|undefined|null/)
    expect(container.textContent).toContain('样本不足')
    expect(container.textContent).toContain('样本 14 日')
    expect(container.querySelector('.quality-bars .meter b').textContent).toBe('暂无')
    unmount()
  })
})
