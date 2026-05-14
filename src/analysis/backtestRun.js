// Lightweight deterministic backtest/stability contracts for ETF 512400 research.
// Pure JS, no runtime dependencies; designed for CI fixtures and later UI export.

function finiteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} 必须是有限数字`)
  }
  return value
}

function asReturnSeries(rows) {
  if (!Array.isArray(rows)) {
    throw new TypeError('BacktestRun.rows 必须是数组')
  }
  const returns = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const rawReturn = row?.return
    if (typeof rawReturn === 'number') {
      if (!Number.isFinite(rawReturn)) {
        throw new RangeError('BacktestRun.rows return 必须是有限数字，禁止 NaN/Infinity')
      }
      returns.push(rawReturn)
      continue
    }
    const rawClose = row?.close
    if (typeof rawClose === 'number' && !Number.isFinite(rawClose)) {
      throw new RangeError('BacktestRun.rows close 必须是有限数字，禁止 NaN/Infinity')
    }
    if (index === 0 && Number.isFinite(rawClose)) continue
    if (Number.isFinite(rawClose) && Number.isFinite(rows[index - 1]?.close)) {
      if (rawClose <= 0 || rows[index - 1].close <= 0) {
        throw new RangeError('BacktestRun close 序列必须为正数，避免 Infinity/NaN 收益')
      }
      returns.push(rawClose / rows[index - 1].close - 1)
      continue
    }
    returns.push(0)
  }
  return returns
}

function annualizedReturn(totalReturn, periods) {
  if (periods <= 0 || totalReturn <= -1) return null
  return Math.pow(1 + totalReturn, 252 / periods) - 1
}

function maxDrawdown(equity) {
  let peak = equity[0] ?? 1
  let worst = 0
  for (const value of equity) {
    peak = Math.max(peak, value)
    if (peak > 0) worst = Math.min(worst, value / peak - 1)
  }
  return worst
}

function turnoverFromExposures(exposures) {
  let turnover = 0
  for (let i = 1; i < exposures.length; i += 1) {
    turnover += Math.abs(exposures[i] - exposures[i - 1])
  }
  return turnover
}

export class BacktestRun {
  constructor({ runId, strategySpecId, parameters = {}, rows = [], exposureFn, feeRate = 0 }) {
    if (typeof runId !== 'string' || runId.trim() === '') throw new TypeError('runId 必须是非空字符串')
    if (typeof strategySpecId !== 'string' || strategySpecId.trim() === '') {
      throw new TypeError('strategySpecId 必须是非空字符串')
    }
    if (typeof exposureFn !== 'function') throw new TypeError('exposureFn 必须是函数')
    this.runId = runId.trim()
    this.strategySpecId = strategySpecId.trim()
    this.parameters = Object.freeze({ ...parameters })
    this.rows = rows.slice()
    this.feeRate = finiteNumber(feeRate, 'feeRate')
    if (this.feeRate < 0) throw new RangeError('feeRate 必须大于等于 0')
    this.exposureFn = exposureFn
  }

  evaluate() {
    const returns = asReturnSeries(this.rows)
    const exposures = []
    const equity = [1]
    let previousExposure = 0
    for (let i = 0; i < returns.length; i += 1) {
      const rawExposure = this.exposureFn({ row: this.rows[i], index: i, rows: this.rows, parameters: this.parameters })
      const exposure = Math.max(0, Math.min(1, finiteNumber(rawExposure, 'exposure')))
      const tradeCost = Math.abs(exposure - previousExposure) * this.feeRate
      const nextEquity = equity[equity.length - 1] * (1 + exposure * returns[i] - tradeCost)
      equity.push(nextEquity)
      exposures.push(exposure)
      previousExposure = exposure
    }
    const totalReturn = equity[equity.length - 1] - 1
    const turnover = turnoverFromExposures(exposures)
    const metrics = Object.freeze({
      sampleSize: returns.length,
      totalReturn,
      annualizedReturn: annualizedReturn(totalReturn, returns.length),
      maxDrawdown: maxDrawdown(equity),
      averageExposure: exposures.length ? exposures.reduce((a, b) => a + b, 0) / exposures.length : 0,
      turnover,
    })
    return Object.freeze({
      runId: this.runId,
      strategySpecId: this.strategySpecId,
      parameters: this.parameters,
      metrics,
      equityCurve: Object.freeze(equity),
      exposures: Object.freeze(exposures),
    })
  }
}

export class StabilityScore {
  constructor({ cohort = [], score = null, label = null, reasons = [] } = {}) {
    const metrics = cohort.map((item) => item?.metrics ?? item).filter(Boolean)
    const returns = metrics.map((m) => m.totalReturn).filter(Number.isFinite)
    const drawdowns = metrics.map((m) => m.maxDrawdown).filter(Number.isFinite)
    const turnovers = metrics.map((m) => m.turnover).filter(Number.isFinite)
    const dispersion = returns.length ? Math.max(...returns) - Math.min(...returns) : 0
    const drawdownPenalty = drawdowns.length ? Math.min(1, Math.abs(Math.min(...drawdowns))) : 0
    const turnoverPenalty = turnovers.length ? Math.min(1, Math.max(...turnovers) / Math.max(1, metrics.length)) : 0
    const computed = score ?? Math.max(0, Math.min(100, 100 - dispersion * 300 - drawdownPenalty * 40 - turnoverPenalty * 20))
    this.score = computed
    this.label = label ?? (computed >= 75 ? 'stable' : computed >= 50 ? 'watch' : 'fragile')
    this.reasons = Object.freeze(reasons.length ? reasons.slice() : [
      `return_dispersion=${dispersion.toFixed(4)}`,
      `drawdown_penalty=${drawdownPenalty.toFixed(4)}`,
      `turnover_penalty=${turnoverPenalty.toFixed(4)}`,
    ])
    Object.freeze(this)
  }

  toJSON() {
    return { score: this.score, label: this.label, reasons: [...this.reasons] }
  }
}

export class OverfitPenalty {
  constructor({ trainScore, testScore, parameterCount = 1, sampleSize = 0 }) {
    finiteNumber(trainScore, 'trainScore')
    finiteNumber(testScore, 'testScore')
    if (!Number.isInteger(parameterCount) || parameterCount < 1) throw new TypeError('parameterCount 必须是正整数')
    if (!Number.isInteger(sampleSize) || sampleSize < 0) throw new TypeError('sampleSize 必须是非负整数')
    const gap = Math.max(0, trainScore - testScore)
    const complexity = parameterCount / Math.max(1, sampleSize)
    this.value = Math.min(1, gap + complexity)
    this.label = this.value >= 0.35 ? 'high' : this.value >= 0.15 ? 'medium' : 'low'
    this.reasons = Object.freeze([
      `train_test_gap=${gap.toFixed(4)}`,
      `complexity=${complexity.toFixed(4)}`,
    ])
    Object.freeze(this)
  }

  toJSON() {
    return { value: this.value, label: this.label, reasons: [...this.reasons] }
  }
}

export function buildBacktestReport({ run, cohort = [], trainScore, testScore }) {
  const result = run.evaluate()
  return Object.freeze({
    ...result,
    stability: new StabilityScore({ cohort: cohort.length ? cohort : [result] }).toJSON(),
    overfitPenalty: new OverfitPenalty({
      trainScore: trainScore ?? result.metrics.totalReturn,
      testScore: testScore ?? result.metrics.totalReturn,
      parameterCount: Object.keys(result.parameters).length || 1,
      sampleSize: result.metrics.sampleSize,
    }).toJSON(),
  })
}
