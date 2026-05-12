import { useMemo, useState } from 'react'
import { compareHoldingsNumeric, formatHoldingWeight } from './holdingsTableSort'

const COLUMNS = [
  { key: 'code', label: '代码' },
  { key: 'name', label: '名称' },
  { key: 'basket', label: '篮子' },
  { key: 'weight', label: '权重', numeric: true },
  { key: 'signal', label: '信号' },
]

export function HoldingsTable({ holdings }) {
  const [sort, setSort] = useState({ key: 'weight', direction: 'desc' })

  const sorted = useMemo(() => {
    const column = COLUMNS.find((item) => item.key === sort.key)
    const factor = sort.direction === 'desc' ? -1 : 1
    return [...holdings].sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (column?.numeric) return compareHoldingsNumeric(av, bv, factor)
      return String(av ?? '').localeCompare(String(bv ?? ''), 'zh-Hans-CN') * factor
    })
  }, [holdings, sort])

  const onSort = (key) =>
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: COLUMNS.find((c) => c.key === key)?.numeric ? 'desc' : 'asc' },
    )

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = sort.key === column.key
              const arrow = active ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''
              return (
                <th
                  key={column.key}
                  onClick={() => onSort(column.key)}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {column.label}
                  {arrow}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((holding) => (
            <tr key={holding.code}>
              <td>{holding.code}</td>
              <td>{holding.name}</td>
              <td>{holding.basket}</td>
              <td>{formatHoldingWeight(holding.weight)}</td>
              <td>{holding.signal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
