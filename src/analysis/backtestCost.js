// 交易成本模型 + 滚动样本外切分（walk-forward）的共享工具。
// 纯函数，无副作用，被 backtest.js 与 optimizer.js 共同复用。

// 单边交易成本（基点）。A股 ETF 场景：
//   - 券商佣金：万 2.5 左右（券商竞争后多数 ≤ 万 3），且 ETF 免征印花税；
//   - 冲击成本/滑点：512400 日均成交约 3 亿元、流动性尚可，取 1.5 bps 量级。
// 合计单边约 4 bps，调仓时按「换手的仓位比例」收取，一次完整加减仓（来回）≈ 8 bps。
// 这是相对保守但贴近真实的口径，宁可把回测数字压低也不要虚高。
export const DEFAULT_COST_BPS_PER_SIDE = 4

// 把基点转成小数（4 bps -> 0.0004）。
export function bpsToRate(bps) {
  return Number.isFinite(bps) && bps > 0 ? bps / 10000 : 0
}

// 成本覆盖值的共享归一化：0 表示显式零成本回测，负数/NaN/Infinity 视为非法配置，
// 回退到默认保守成本，避免优化器摘要与真实扣费口径不一致。
export function normalizeCostBpsPerSide(costBpsPerSide) {
  return Number.isFinite(costBpsPerSide) && costBpsPerSide >= 0
    ? costBpsPerSide
    : DEFAULT_COST_BPS_PER_SIDE
}

// 单根 K 线上的调仓成本：换手率 = |新仓位 - 旧仓位|，乘单边费率。
// 仓位从 0.4 调到 0.8 即换手 0.4，扣 0.4 * costRate 的当期收益。
// 这样建仓、加仓、减仓、清仓都会被对称地计费，不会漏掉任何一次再平衡。
export function rebalanceCost(previousExposure, nextExposure, costRate) {
  if (!Number.isFinite(costRate) || costRate <= 0) return 0
  const turnover = Math.abs((nextExposure ?? 0) - (previousExposure ?? 0))
  return turnover * costRate
}

// 生成 walk-forward 滚动窗口：把样本切成多个「训练段 + 紧随其后的测试段」。
// 相邻折按 step 向前滚动，测试段互不重叠，最大程度模拟真实的逐段样本外推进。
//   length      —— 清洗后的 K 线总根数
//   trainSpan   —— 每折训练段交易日数
//   testSpan    —— 每折测试段交易日数
//   step        —— 折与折之间向前滚动的步长（默认 = testSpan，使测试段首尾相接不重叠）
// 返回 [{ index, trainStart, trainEnd, testStart, testEnd }]，索引区间闭区间。
export function buildWalkForwardFolds({ length, trainSpan, testSpan, step }) {
  const folds = []
  if (
    !Number.isFinite(length) ||
    !Number.isFinite(trainSpan) ||
    !Number.isFinite(testSpan) ||
    trainSpan < 1 ||
    testSpan < 1 ||
    length < trainSpan + testSpan
  ) {
    return folds
  }

  const rollStep = Number.isFinite(step) && step > 0 ? Math.floor(step) : testSpan
  let trainStart = 0
  let index = 0

  while (trainStart + trainSpan + testSpan <= length) {
    const trainEnd = trainStart + trainSpan - 1
    const testStart = trainEnd + 1
    const testEnd = Math.min(testStart + testSpan - 1, length - 1)
    folds.push({ index, trainStart, trainEnd, testStart, testEnd })
    index += 1
    trainStart += rollStep
  }

  return folds
}

// 根据样本长度自适应地决定折的几何形状。
// 目标：在有限样本（512400 当前约 280 根）下仍能切出 ≥3 折，
// 同时保证每折训练段足够长（容纳最长慢线窗口），测试段不至于太短而失真。
export function planWalkForward(length, { minFolds = 3, maxFolds = 6 } = {}) {
  if (!Number.isFinite(length) || length < 120) {
    return { folds: [], trainSpan: 0, testSpan: 0, step: 0 }
  }

  // 测试段占比约 22%，但夹在 [40, 130] 之间：太短样本外噪声大，太长折数不够。
  let testSpan = Math.max(40, Math.min(130, Math.round(length * 0.22)))
  // 训练段约为测试段的 1.6 倍，且至少 130 根（容纳 120 日慢线 + 预热）。
  let trainSpan = Math.max(130, Math.round(testSpan * 1.6))

  if (length < trainSpan + testSpan) {
    return { folds: [], trainSpan, testSpan, step: 0 }
  }

  // 先按「测试段不重叠」铺折；若折数不足 minFolds，再缩短测试段补折。
  // 下游会复合各折样本外收益，因此 plan 层必须保持 step >= testSpan，避免重叠测试窗被重复计入。
  let step = testSpan
  let folds = buildWalkForwardFolds({ length, trainSpan, testSpan, step })

  if (folds.length < minFolds && minFolds > 1) {
    testSpan = Math.max(40, Math.min(testSpan, Math.floor((length - trainSpan) / minFolds)))
    trainSpan = Math.max(130, Math.round(testSpan * 1.6))
    step = testSpan
    folds = buildWalkForwardFolds({ length, trainSpan, testSpan, step })
  }

  if (folds.length > maxFolds) {
    folds = folds.slice(0, maxFolds)
  }

  return { folds, trainSpan, testSpan, step }
}
