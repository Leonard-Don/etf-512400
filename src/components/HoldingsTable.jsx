export function HoldingsTable({ holdings }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>篮子</th>
            <th>权重</th>
            <th>信号</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => (
            <tr key={holding.code}>
              <td>{holding.code}</td>
              <td>{holding.name}</td>
              <td>{holding.basket}</td>
              <td>{holding.weight.toFixed(2)}%</td>
              <td>{holding.signal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
