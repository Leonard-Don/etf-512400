const scenarioAdjustmentById = {
  base: {
    label: '基准情景',
    tabLabel: '基准',
    priceShock: 0,
    volShock: 0,
    note: '维持当前高波动震荡假设',
  },
  goldRisk: {
    label: '黄金避险升温',
    tabLabel: '黄金避险',
    priceShock: 0.052,
    volShock: 0.04,
    note: '黄金链权重受益，ETF弹性抬升',
  },
  dollarUp: {
    label: '美元利率上行',
    tabLabel: '美元利率',
    priceShock: -0.066,
    volShock: 0.08,
    note: '贵金属和高估值资源股同时承压',
  },
  demandSoft: {
    label: '制造业需求走弱',
    tabLabel: '需求走弱',
    priceShock: -0.044,
    volShock: 0.06,
    note: '铜铝链拖累，防守看黄金占比',
  },
}

export const scenarioDefinitions = [
  { id: 'base', ...scenarioAdjustmentById.base },
  { id: 'goldRisk', ...scenarioAdjustmentById.goldRisk },
  { id: 'dollarUp', ...scenarioAdjustmentById.dollarUp },
  { id: 'demandSoft', ...scenarioAdjustmentById.demandSoft },
]

export function getScenarioAdjustment(scenario) {
  return scenarioAdjustmentById[scenario] ?? scenarioAdjustmentById.base
}
