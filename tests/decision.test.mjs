import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composePrimaryDecision } from '../src/analysis/decision.js'

const baseSignal = {
  action: '小仓跟踪',
  tone: 'positive',
  score: 70,
  suggestedExposure: 0.4,
  confidence: 75,
}

const baseOptimizer = {
  ok: true,
  best: {
    label: '20/60日趋势，5%/12%回撤',
    stabilityScore: 78,
    overfitRisk: '低',
    current: {
      action: '主仓持有',
      tone: 'positive',
      exposure: 0.95,
    },
  },
}

const baseTrend = { state: '上升趋势' }

test('优化器可用时主结论来自优化器；仓位被风险预算上限 clamp', () => {
  const result = composePrimaryDecision({
    signal: baseSignal,
    optimizer: baseOptimizer,
    riskBudget: 60,
    trendProfile: baseTrend,
  })
  assert.equal(result.action, '主仓持有')
  assert.equal(result.source, '自动优化')
  assert.ok(result.exposure <= 0.6 + 1e-9, `期望 ≤0.6，实际 ${result.exposure}`)
})

test('优化器不可用时回退到信号引擎', () => {
  const result = composePrimaryDecision({
    signal: baseSignal,
    optimizer: { ok: false },
    riskBudget: 60,
    trendProfile: baseTrend,
  })
  assert.equal(result.source, '信号引擎')
  assert.equal(result.action, '小仓跟踪')
})

test('信号 tone=warning 时主结论吸收信号动作并压低仓位', () => {
  const warningSignal = {
    ...baseSignal,
    action: '禁止追高',
    tone: 'warning',
    suggestedExposure: 0.18,
  }
  const result = composePrimaryDecision({
    signal: warningSignal,
    optimizer: baseOptimizer,
    riskBudget: 80,
    trendProfile: baseTrend,
  })
  assert.equal(result.action, '禁止追高')
  assert.equal(result.tone, 'warning')
  assert.ok(
    result.exposure <= 0.18 + 1e-9,
    `应被信号建议仓位压制到 ≤0.18，实际 ${result.exposure}`,
  )
  assert.match(result.rule, /信号 禁止追高/)
})

test('风险降档同样应该把仓位压到信号建议', () => {
  const warningSignal = {
    ...baseSignal,
    action: '风险降档',
    tone: 'warning',
    suggestedExposure: 0.05,
  }
  const result = composePrimaryDecision({
    signal: warningSignal,
    optimizer: baseOptimizer,
    riskBudget: 60,
    trendProfile: baseTrend,
  })
  assert.equal(result.action, '风险降档')
  assert.ok(result.exposure <= 0.05 + 1e-9)
})

test('signal 是 positive 时不覆盖优化器结论', () => {
  const result = composePrimaryDecision({
    signal: { ...baseSignal, action: '分批加仓', tone: 'positive', suggestedExposure: 0.35 },
    optimizer: baseOptimizer,
    riskBudget: 80,
    trendProfile: baseTrend,
  })
  assert.equal(result.action, '主仓持有')
})

test('opportunity 也不覆盖（只有 warning 是硬约束）', () => {
  const oppSignal = {
    ...baseSignal,
    action: '分批低吸',
    tone: 'opportunity',
    suggestedExposure: 0.25,
  }
  const result = composePrimaryDecision({
    signal: oppSignal,
    optimizer: baseOptimizer,
    riskBudget: 70,
    trendProfile: baseTrend,
  })
  assert.equal(result.action, '主仓持有')
})

test('回退分支（无优化器）+ 信号 warning：仍然显示信号动作', () => {
  const warningSignal = {
    ...baseSignal,
    action: '禁止追高',
    tone: 'warning',
    suggestedExposure: 0.12,
  }
  const result = composePrimaryDecision({
    signal: warningSignal,
    optimizer: { ok: false, reason: '样本不足' },
    riskBudget: 70,
    trendProfile: { state: '震荡观察' },
  })
  assert.equal(result.action, '禁止追高')
  assert.equal(result.tone, 'warning')
  assert.equal(result.source, '信号引擎')
  assert.ok(result.exposure <= 0.12 + 1e-9)
})
