export function mapSeriesToPolyline(series, key, width = 520, height = 150) {
  const values = series.map((point) => point[key])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const xStep = width / Math.max(series.length - 1, 1)

  return values
    .map((value, index) => {
      const x = index * xStep
      const y = height - ((value - min) / span) * height
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}
