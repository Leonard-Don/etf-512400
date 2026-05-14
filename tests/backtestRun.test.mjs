import assert from 'node:assert/strict'
import test from 'node:test'

import { BacktestRun, OverfitPenalty, StabilityScore, buildBacktestReport } from '../src/analysis/backtestRun.js'

const rows = [
  { date: '2026-01-01', close: 10 },
  { date: '2026-01-02', close: 10.5 },
  { date: '2026-01-03', close: 10.0 },
  { date: '2026-01-04', close: 10.8 },
]

test('BacktestRun evaluates deterministic exposure, return, drawdown and turnover', () => {
  const run = new BacktestRun({
    runId: 'bt-1',
    strategySpecId: 'sma-cross',
    parameters: { fastWindow: 5, slowWindow: 20 },
    rows,
    exposureFn: ({ index }) => (index === 0 ? 0 : 1),
    feeRate: 0,
  })

  const result = run.evaluate()

  assert.equal(result.runId, 'bt-1')
  assert.equal(result.strategySpecId, 'sma-cross')
  assert.equal(result.metrics.sampleSize, rows.length - 1)
  assert.equal(result.exposures[0], 0)
  assert.equal(result.exposures.slice(1).every((x) => x === 1), true)
  assert.equal(result.metrics.turnover, 1)
  assert.ok(result.metrics.totalReturn > 0)
  assert.ok(result.metrics.maxDrawdown < 0)
})

test('BacktestRun clamps out-of-range exposures and rejects bad identifiers', () => {
  const run = new BacktestRun({
    runId: 'bt-clamp',
    strategySpecId: 'spec',
    rows: [{ return: 0.1 }],
    exposureFn: () => 2,
  })
  assert.equal(run.evaluate().exposures[0], 1)

  assert.throws(() => new BacktestRun({ runId: '', strategySpecId: 'spec', rows: [], exposureFn: () => 0 }), /runId/)
  assert.throws(() => new BacktestRun({ runId: 'x', strategySpecId: 'spec', rows: [], exposureFn: null }), /exposureFn/)
})

test('BacktestRun rejects negative fees and non-positive close-derived returns', () => {
  assert.throws(() => new BacktestRun({
    runId: 'bad-fee',
    strategySpecId: 'spec',
    rows: [{ return: 0 }],
    exposureFn: () => 1,
    feeRate: -0.001,
  }), /feeRate/)

  const run = new BacktestRun({
    runId: 'bad-close',
    strategySpecId: 'spec',
    rows: [{ close: 0 }, { close: 10 }],
    exposureFn: () => 1,
  })
  assert.throws(() => run.evaluate(), /close/)
})

test('BacktestRun preserves explicit zero return but rejects non-finite return/close rows', () => {
  const zeroRun = new BacktestRun({
    runId: 'bt-zero',
    strategySpecId: 'spec',
    rows: [{ return: 0 }, { return: 0.05 }, { return: 0 }],
    exposureFn: () => 1,
  })
  const zeroResult = zeroRun.evaluate()
  assert.equal(zeroResult.metrics.sampleSize, 3)
  assert.ok(Math.abs(zeroResult.metrics.totalReturn - 0.05) < 1e-12)

  const nanReturnRun = new BacktestRun({
    runId: 'bt-nan-return',
    strategySpecId: 'spec',
    rows: [{ return: 0.01 }, { return: Number.NaN }],
    exposureFn: () => 1,
  })
  assert.throws(() => nanReturnRun.evaluate(), /return/)

  const infReturnRun = new BacktestRun({
    runId: 'bt-inf-return',
    strategySpecId: 'spec',
    rows: [{ return: 0.01 }, { return: Number.POSITIVE_INFINITY }],
    exposureFn: () => 1,
  })
  assert.throws(() => infReturnRun.evaluate(), /return/)

  const nanCloseRun = new BacktestRun({
    runId: 'bt-nan-close',
    strategySpecId: 'spec',
    rows: [{ close: 10 }, { close: Number.NaN }],
    exposureFn: () => 1,
  })
  assert.throws(() => nanCloseRun.evaluate(), /close/)
})

test('StabilityScore downgrades dispersed parameter cohorts', () => {
  const stable = new StabilityScore({
    cohort: [
      { metrics: { totalReturn: 0.10, maxDrawdown: -0.02, turnover: 0.2 } },
      { metrics: { totalReturn: 0.11, maxDrawdown: -0.02, turnover: 0.2 } },
    ],
  })
  const fragile = new StabilityScore({
    cohort: [
      { metrics: { totalReturn: 0.40, maxDrawdown: -0.50, turnover: 4.0 } },
      { metrics: { totalReturn: -0.20, maxDrawdown: -0.50, turnover: 4.0 } },
    ],
  })

  assert.equal(stable.label, 'stable')
  assert.equal(fragile.label, 'fragile')
  assert.ok(stable.score > fragile.score)
})

test('OverfitPenalty grades train/test gap and parameter complexity', () => {
  const low = new OverfitPenalty({ trainScore: 0.12, testScore: 0.11, parameterCount: 2, sampleSize: 200 })
  const high = new OverfitPenalty({ trainScore: 0.8, testScore: 0.1, parameterCount: 12, sampleSize: 20 })

  assert.equal(low.label, 'low')
  assert.equal(high.label, 'high')
  assert.ok(high.value > low.value)
})

test('buildBacktestReport includes stability and overfitPenalty contracts', () => {
  const run = new BacktestRun({
    runId: 'bt-report',
    strategySpecId: 'spec',
    rows,
    parameters: { fastWindow: 5 },
    exposureFn: () => 1,
  })

  const report = buildBacktestReport({ run, trainScore: 0.2, testScore: 0.18 })

  assert.equal(report.runId, 'bt-report')
  assert.equal(typeof report.stability.score, 'number')
  assert.match(report.overfitPenalty.label, /low|medium|high/)
})
