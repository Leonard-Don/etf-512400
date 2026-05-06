// 信号引擎 / 决策合成的所有可调阈值统一在此处定义。
// 调整任意系数前请重跑回测与 smokeTest，并在 PR 描述中给出对照。

// 综合分由 5 个分量加权合成，权重总和应为 1.0
export const COMPONENT_WEIGHTS = {
  momentum: 0.34, // 趋势分量
  factor: 0.28, // 因子分量
  valuation: 0.16, // 估值分量
  liquidity: 0.12, // 流动性分量
  riskBudget: 0.1, // 用户当前的风险预算
}

// 决策档位阈值
export const SCORE_TIERS = {
  addPosition: 72, // 加仓档，需满足风险预算 ≥55 且高风险因子 ≤2
  trackOnly: 62, // 小仓跟踪
  dipBuy: 52, // 分批低吸：需要回撤 ≤-6% 且趋势分 ≥55
  riskOff: 42, // 风险降档
}

// 否决（追高）规则：触发后分数被强制压到 vetoCap
export const VETO = {
  premium: 0.008, // 折溢价 >0.8% 视作高估
  dailyChange: 0.045, // 单日涨幅 >4.5% 视作追高
  highRiskFactors: 3, // 高风险因子 ≥3 即否决
  vetoCap: 49,
}

// 加仓档附加门槛：综合分够，但风险预算 / 高风险因子任一不达标都不允许加仓
export const ADD_POSITION_GATES = {
  minRiskBudget: 55,
  maxHighRiskFactors: 2,
}

// 分批低吸附加门槛：分数到了，但需要回撤够深、因子趋势分够强
export const DIP_BUY_GATES = {
  maxDrawdown: -0.06,
  minFactorTrendScore: 55,
}

// 仓位映射：综合分 35→仓位 0；100→仓位 = exposureCap
export const POSITION = {
  scoreFloor: 35,
  scoreSpan: 65,
  capMin: 0.2,
  capMax: 0.8,
}

// 经验校准系数（来自历史回测）
export const FACTOR_RISK_DAMPEN = 0.18 // 因子分中风险扣减权重
export const FACTOR_BASELINE = 12 // 因子分基线偏移
export const VALUATION_BASE = 58 // 折溢价 = 0 时的估值分
export const VALUATION_SLOPE = 1800 // 折溢价每个百分点 → 估值分变化 18 分
export const LIQUIDITY_BASE = 42 // 成交额 = 1 亿时的流动性分
export const LIQUIDITY_SLOPE = 26 // 成交额每 10 倍 → 流动性分 +26
export const DRAWDOWN_BONUS_SLOPE = 170 // 回撤每 1% → 加分 1.7
export const DRAWDOWN_BONUS_CAP = 14
export const HIGH_RISK_FACTOR_PENALTY = 4 // 每个高风险因子扣分
export const VOL_THRESHOLD = 0.36 // 年化波动率超过此值开始扣分
export const VOL_PENALTY_SLOPE = 45
export const VOL_PENALTY_CAP = 12
export const CONFIDENCE_BASE = 48
export const CONFIDENCE_PER_SAMPLE = 0.12
export const CONFIDENCE_PER_POSITIVE_FACTOR = 5
export const CONFIDENCE_RANGE = [35, 86]
