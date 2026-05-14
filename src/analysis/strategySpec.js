// 可序列化的策略契约：描述 signal/weights/rebalance 三段假设，便于参数网格、回测、稳定性评估共用同一份"规范说明"。
// 设计取向：纯数据，可 JSON 化；构造时强校验，构造后冻结；不依赖运行时上下文（行情、因子）。

const SCHEMA_VERSION = 1

const SIGNAL_TYPES = new Set(['smaCross', 'pullback', 'breakout', 'custom'])
const WEIGHT_TYPES = new Set(['binary', 'tiered', 'continuous'])
const REBALANCE_FREQUENCIES = new Set(['daily', 'weekly', 'monthly'])

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep)
    return Object.freeze(value)
  }
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep)
    return Object.freeze(value)
  }
  return value
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function validateSignal(signal) {
  if (signal === null || typeof signal !== 'object') {
    throw new TypeError('StrategySpec.signal 必须是对象')
  }
  if (!SIGNAL_TYPES.has(signal.type)) {
    throw new TypeError(
      `StrategySpec.signal.type 必须为 ${[...SIGNAL_TYPES].join('/')} 其一，收到 "${signal.type}"`,
    )
  }
  const params = signal.params ?? {}
  if (signal.type === 'smaCross') {
    const { fastWindow, slowWindow } = params
    if (!isPositiveInteger(fastWindow)) {
      throw new TypeError('StrategySpec.signal.params.fastWindow 必须是正整数')
    }
    if (!isPositiveInteger(slowWindow)) {
      throw new TypeError('StrategySpec.signal.params.slowWindow 必须是正整数')
    }
    if (fastWindow >= slowWindow) {
      throw new RangeError(
        `StrategySpec.smaCross 要求 fastWindow < slowWindow，收到 ${fastWindow} / ${slowWindow}`,
      )
    }
  }
  if (signal.type === 'pullback') {
    const tiers = Array.isArray(params.tiers) ? params.tiers : null
    if (!tiers || tiers.length === 0) {
      throw new TypeError('StrategySpec.signal.params.tiers 必须是非空数组')
    }
    for (let i = 0; i < tiers.length; i += 1) {
      if (!Number.isFinite(tiers[i]) || tiers[i] <= 0) {
        throw new TypeError(`StrategySpec.signal.params.tiers[${i}] 必须是正数`)
      }
      if (i > 0 && tiers[i] <= tiers[i - 1]) {
        throw new RangeError('StrategySpec.signal.params.tiers 必须严格递增（ascending）')
      }
    }
  }
  if (signal.type === 'breakout') {
    if (!isPositiveInteger(params.lookback)) {
      throw new TypeError('StrategySpec.signal.params.lookback 必须是正整数')
    }
  }
}

function validateWeights(weights) {
  if (weights === null || typeof weights !== 'object') {
    throw new TypeError('StrategySpec.weights 必须是对象')
  }
  if (!WEIGHT_TYPES.has(weights.type)) {
    throw new TypeError(
      `StrategySpec.weights.type 必须为 ${[...WEIGHT_TYPES].join('/')} 其一，收到 "${weights.type}"`,
    )
  }
  const levels = Array.isArray(weights.levels) ? weights.levels : null
  if (!levels || levels.length === 0) {
    throw new TypeError('StrategySpec.weights.levels 必须是非空数组')
  }
  levels.forEach((level, index) => {
    if (!isNonEmptyString(level.when)) {
      throw new TypeError(`StrategySpec.weights.levels[${index}].when 必须是非空字符串`)
    }
    if (!Number.isFinite(level.exposure) || level.exposure < 0 || level.exposure > 1) {
      throw new RangeError(
        `StrategySpec.weights.levels[${index}].exposure 必须在 [0,1] 之间，收到 ${level.exposure}`,
      )
    }
  })
}

function validateRebalance(rebalance) {
  if (rebalance === null || typeof rebalance !== 'object') {
    throw new TypeError('StrategySpec.rebalance 必须是对象')
  }
  if (!REBALANCE_FREQUENCIES.has(rebalance.frequency)) {
    throw new TypeError(
      `StrategySpec.rebalance.frequency 必须为 ${[...REBALANCE_FREQUENCIES].join('/')} 其一`,
    )
  }
  const delta = rebalance.minTradeDelta
  if (!Number.isFinite(delta) || delta < 0 || delta > 1) {
    throw new RangeError(
      `StrategySpec.rebalance.minTradeDelta 必须在 [0,1] 之间，收到 ${delta}`,
    )
  }
}

export function defineStrategySpec(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('StrategySpec 输入必须是对象')
  }
  if (!isNonEmptyString(input.id)) {
    throw new TypeError('StrategySpec.id 必须是非空字符串')
  }
  if (!isNonEmptyString(input.name)) {
    throw new TypeError('StrategySpec.name 必须是非空字符串')
  }
  validateSignal(input.signal)
  validateWeights(input.weights)
  validateRebalance(input.rebalance)

  const cloned = deepClone({
    schemaVersion: SCHEMA_VERSION,
    id: input.id.trim(),
    name: input.name.trim(),
    signal: {
      type: input.signal.type,
      params: input.signal.params ?? {},
    },
    weights: {
      type: input.weights.type,
      levels: input.weights.levels,
    },
    rebalance: {
      frequency: input.rebalance.frequency,
      minTradeDelta: input.rebalance.minTradeDelta,
    },
    notes: typeof input.notes === 'string' ? input.notes : '',
  })

  return freezeDeep(cloned)
}

export function serializeStrategySpec(spec) {
  if (spec === null || typeof spec !== 'object') {
    throw new TypeError('serializeStrategySpec 输入必须是 StrategySpec')
  }
  return deepClone(spec)
}

export function deserializeStrategySpec(json) {
  if (json === null || typeof json !== 'object') {
    throw new TypeError('deserializeStrategySpec 输入必须是 JSON 对象')
  }
  if (json.schemaVersion !== SCHEMA_VERSION) {
    throw new RangeError(
      `StrategySpec.schemaVersion 不匹配：期望 ${SCHEMA_VERSION}，收到 ${json.schemaVersion}`,
    )
  }
  return defineStrategySpec(json)
}

export const STRATEGY_SPEC_SCHEMA_VERSION = SCHEMA_VERSION
export const SUPPORTED_SIGNAL_TYPES = Object.freeze([...SIGNAL_TYPES])
export const SUPPORTED_WEIGHT_TYPES = Object.freeze([...WEIGHT_TYPES])
export const SUPPORTED_REBALANCE_FREQUENCIES = Object.freeze([...REBALANCE_FREQUENCIES])
