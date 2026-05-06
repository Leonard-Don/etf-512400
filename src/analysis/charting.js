// 把序列点映射到 SVG polyline 的字符串。空序列或全部缺失时返回空字符串
// （SVG polyline 给空 points 时不渲染任何东西，是希望的行为）。
export function mapSeriesToPolyline(series, key, width = 520, height = 150) {
  if (!Array.isArray(series) || series.length === 0) return ''
  const values = series.map((point) => point?.[key])
  const valid = values.filter((value) => Number.isFinite(value))
  if (!valid.length) return ''
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const span = max - min || 1
  const xStep = width / Math.max(series.length - 1, 1)

  return values
    .map((value, index) => {
      if (!Number.isFinite(value)) return null
      const x = index * xStep
      const y = height - ((value - min) / span) * height
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .filter(Boolean)
    .join(' ')
}
