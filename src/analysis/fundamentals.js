export function calculatePremium(price, nav) {
  if (!Number.isFinite(price) || !Number.isFinite(nav) || nav === 0) return 0
  return price / nav - 1
}

export function calculateDailyChange(price, previousClose) {
  if (!Number.isFinite(price) || !Number.isFinite(previousClose) || previousClose === 0) return 0
  return price / previousClose - 1
}

export function sumWeights(items) {
  return items.reduce((total, item) => total + item.weight, 0)
}

export function groupHoldingsByBasket(holdings) {
  const grouped = holdings.reduce((acc, holding) => {
    const current = acc.get(holding.basket) ?? {
      basket: holding.basket,
      weight: 0,
      names: [],
      marketValue: 0,
    }

    current.weight += holding.weight
    current.marketValue += holding.marketValue
    current.names.push(holding.name)
    acc.set(holding.basket, current)
    return acc
  }, new Map())

  return Array.from(grouped.values()).sort((a, b) => b.weight - a.weight)
}
