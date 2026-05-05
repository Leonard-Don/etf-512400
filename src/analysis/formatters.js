export function formatPercent(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return '暂无'
  return `${(Number(value) * 100).toFixed(digits)}%`
}

export function formatSignedPercent(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return '暂无'
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatPercent(value, digits)}`
}

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return '暂无'
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatCnyAmount(value) {
  if (!Number.isFinite(value)) return '暂无'
  if (Math.abs(value) >= 100000000) return `${formatNumber(value / 100000000, 2)}亿`
  if (Math.abs(value) >= 10000) return `${formatNumber(value / 10000, 2)}万`
  return formatNumber(value, 0)
}

export function formatSnapshotTime(value) {
  if (!value) return '未刷新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/\//g, '-')
}
