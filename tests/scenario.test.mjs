import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getScenarioAdjustment, scenarioDefinitions } from '../src/analysis/scenario.js'

test('scenarioDefinitions exposes comparable price and volatility impacts for every What-If tab', () => {
  assert.deepEqual(
    scenarioDefinitions.map(({ id, tabLabel, baseline, priceShock, volShock }) => ({
      id,
      tabLabel,
      baseline: baseline ?? false,
      priceShock,
      volShock,
    })),
    [
      { id: 'base', tabLabel: '基准', baseline: true, priceShock: 0, volShock: 0 },
      { id: 'goldRisk', tabLabel: '黄金避险', baseline: false, priceShock: 0.052, volShock: 0.04 },
      { id: 'dollarUp', tabLabel: '美元利率', baseline: false, priceShock: -0.066, volShock: 0.08 },
      { id: 'demandSoft', tabLabel: '需求走弱', baseline: false, priceShock: -0.044, volShock: 0.06 },
    ],
  )
})

test('getScenarioAdjustment falls back to base scenario for unknown ids', () => {
  assert.equal(getScenarioAdjustment('missing').label, '基准情景')
  assert.equal(getScenarioAdjustment('missing').priceShock, 0)
  assert.equal(getScenarioAdjustment('missing').volShock, 0)
})
