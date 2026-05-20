import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_COST_BPS_PER_SIDE,
  bpsToRate,
  normalizeCostBpsPerSide,
  rebalanceCost,
  buildWalkForwardFolds,
  planWalkForward,
} from '../src/analysis/backtestCost.js'

const approx = (actual, expected, tol = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tol, `期望 ${expected} ± ${tol}，实际 ${actual}`)
}

// ---- 交易成本：基点换算 ----

test('DEFAULT_COST_BPS_PER_SIDE 是贴近 A股 ETF 的保守正数', () => {
  assert.ok(Number.isFinite(DEFAULT_COST_BPS_PER_SIDE))
  assert.ok(DEFAULT_COST_BPS_PER_SIDE > 0 && DEFAULT_COST_BPS_PER_SIDE <= 10)
})

test('bpsToRate：4 bps → 0.0004，非法输入兜底为 0', () => {
  approx(bpsToRate(4), 0.0004)
  approx(bpsToRate(8), 0.0008)
  assert.equal(bpsToRate(0), 0)
  assert.equal(bpsToRate(-3), 0)
  assert.equal(bpsToRate(NaN), 0)
  assert.equal(bpsToRate(Infinity), 0)
})

test('normalizeCostBpsPerSide：允许 0 成本回测，非法覆盖值回退默认保守成本', () => {
  assert.equal(normalizeCostBpsPerSide(0), 0)
  assert.equal(normalizeCostBpsPerSide(6), 6)
  assert.equal(normalizeCostBpsPerSide(undefined), DEFAULT_COST_BPS_PER_SIDE)
  assert.equal(normalizeCostBpsPerSide(-2), DEFAULT_COST_BPS_PER_SIDE)
  assert.equal(normalizeCostBpsPerSide(NaN), DEFAULT_COST_BPS_PER_SIDE)
  assert.equal(normalizeCostBpsPerSide(Infinity), DEFAULT_COST_BPS_PER_SIDE)
})

// ---- 交易成本：单根 K 线调仓成本 ----

test('rebalanceCost：换手 = |Δexposure|，乘单边费率', () => {
  // 仓位从 0.4 调到 0.8 → 换手 0.4 → 成本 0.4 * 0.0004
  approx(rebalanceCost(0.4, 0.8, 0.0004), 0.4 * 0.0004)
  // 减仓同样计费：1 → 0.2 换手 0.8
  approx(rebalanceCost(1, 0.2, 0.0004), 0.8 * 0.0004)
  // 首次建仓：0 → 0.5 换手 0.5
  approx(rebalanceCost(0, 0.5, 0.0004), 0.5 * 0.0004)
})

test('rebalanceCost：仓位不变 → 零成本', () => {
  approx(rebalanceCost(0.6, 0.6, 0.0004), 0)
  approx(rebalanceCost(0, 0, 0.0004), 0)
})

test('rebalanceCost：费率为 0 或非法 → 零成本', () => {
  assert.equal(rebalanceCost(0, 1, 0), 0)
  assert.equal(rebalanceCost(0, 1, -1), 0)
  assert.equal(rebalanceCost(0, 1, NaN), 0)
})

test('rebalanceCost：缺省仓位按 0 处理（窗口边界首根建仓也计费）', () => {
  approx(rebalanceCost(undefined, 0.7, 0.0004), 0.7 * 0.0004)
  approx(rebalanceCost(0.7, undefined, 0.0004), 0.7 * 0.0004)
})

test('rebalanceCost：成本对称——加仓再减回原仓，两段成本相等', () => {
  const up = rebalanceCost(0.3, 0.9, 0.0005)
  const down = rebalanceCost(0.9, 0.3, 0.0005)
  approx(up, down)
})

// ---- walk-forward：固定参数铺折 ----

test('buildWalkForwardFolds：测试段默认首尾相接、互不重叠', () => {
  const folds = buildWalkForwardFolds({ length: 300, trainSpan: 120, testSpan: 60 })
  assert.ok(folds.length >= 2)
  folds.forEach((fold) => {
    assert.equal(fold.trainEnd - fold.trainStart + 1, 120)
    assert.equal(fold.testStart, fold.trainEnd + 1)
    assert.ok(fold.testEnd >= fold.testStart)
    assert.ok(fold.testEnd <= 299)
  })
  // 默认 step = testSpan → 相邻折训练起点相差 60
  for (let i = 1; i < folds.length; i += 1) {
    assert.equal(folds[i].trainStart - folds[i - 1].trainStart, 60)
  }
})

test('buildWalkForwardFolds：训练段永远在测试段之前（无未来信息泄漏）', () => {
  const folds = buildWalkForwardFolds({ length: 400, trainSpan: 150, testSpan: 50 })
  assert.ok(folds.length > 0)
  folds.forEach((fold) => {
    assert.ok(fold.trainStart >= 0)
    assert.ok(fold.trainEnd < fold.testStart, '训练段必须早于测试段')
  })
})

test('buildWalkForwardFolds：自定义 step 让训练窗重叠以挤出更多折', () => {
  const wide = buildWalkForwardFolds({ length: 300, trainSpan: 120, testSpan: 60, step: 60 })
  const dense = buildWalkForwardFolds({ length: 300, trainSpan: 120, testSpan: 60, step: 30 })
  assert.ok(dense.length > wide.length)
})

test('buildWalkForwardFolds：fold.index 从 0 连续递增', () => {
  const folds = buildWalkForwardFolds({ length: 500, trainSpan: 150, testSpan: 60 })
  folds.forEach((fold, i) => assert.equal(fold.index, i))
})

test('buildWalkForwardFolds：样本不足一折 → 返回空数组', () => {
  assert.equal(buildWalkForwardFolds({ length: 100, trainSpan: 120, testSpan: 60 }).length, 0)
  // 刚好 trainSpan + testSpan → 恰好 1 折
  assert.equal(buildWalkForwardFolds({ length: 180, trainSpan: 120, testSpan: 60 }).length, 1)
})

test('buildWalkForwardFolds：非法入参 → 返回空数组', () => {
  assert.deepEqual(buildWalkForwardFolds({ length: NaN, trainSpan: 120, testSpan: 60 }), [])
  assert.deepEqual(buildWalkForwardFolds({ length: 300, trainSpan: 0, testSpan: 60 }), [])
  assert.deepEqual(buildWalkForwardFolds({ length: 300, trainSpan: 120, testSpan: 0 }), [])
})

// ---- walk-forward：自适应规划 ----

test('planWalkForward：280 根样本（512400 当前规模）测试窗不重叠', () => {
  const plan = planWalkForward(280)
  assert.ok(plan.folds.length >= 3, `期望至少 3 折，实际 ${plan.folds.length}`)
  assert.ok(plan.trainSpan >= 130, '训练段需容纳 120 日慢线 + 预热')
  assert.ok(plan.testSpan >= 40)
  assert.ok(plan.step >= plan.testSpan, `step ${plan.step} 不应小于 testSpan ${plan.testSpan}`)
  assert.equal(plan.folds.at(-1).testEnd, 279, '最后一折应覆盖最新样本')
  for (let i = 1; i < plan.folds.length; i += 1) {
    assert.ok(
      plan.folds[i].testStart > plan.folds[i - 1].testEnd,
      `测试窗重叠：${plan.folds[i - 1].testStart}-${plan.folds[i - 1].testEnd} 与 ${plan.folds[i].testStart}-${plan.folds[i].testEnd}`,
    )
  }
})

test('planWalkForward：折数受 maxFolds 上限约束', () => {
  const plan = planWalkForward(2000, { maxFolds: 6 })
  assert.ok(plan.folds.length <= 6)
})

test('planWalkForward：所有折训练段早于测试段、测试段不越界', () => {
  const plan = planWalkForward(360)
  assert.ok(plan.folds.length > 0)
  plan.folds.forEach((fold) => {
    assert.ok(fold.trainEnd < fold.testStart)
    assert.ok(fold.testEnd <= 359)
    assert.ok(fold.trainStart >= 0)
  })
})

test('planWalkForward：样本过小（<120）→ 空折', () => {
  assert.deepEqual(planWalkForward(80).folds, [])
  assert.deepEqual(planWalkForward(NaN).folds, [])
})

test('planWalkForward：样本不足以满足 minFolds 时也不压缩到重叠测试窗', () => {
  // 样本刚够铺出少量折时，宁可少于 minFolds，也不能让样本外测试窗重叠复合。
  const plan = planWalkForward(220, { minFolds: 3 })
  if (plan.trainSpan + plan.testSpan <= 220) {
    assert.ok(plan.folds.length >= 1)
  }
  assert.ok(plan.step >= plan.testSpan, `step ${plan.step} 不应小于 testSpan ${plan.testSpan}`)
  for (let i = 1; i < plan.folds.length; i += 1) {
    assert.ok(plan.folds[i].testStart > plan.folds[i - 1].testEnd)
  }
})
