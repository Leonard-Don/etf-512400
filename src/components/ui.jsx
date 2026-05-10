export function MetricCard({ label, value, helper, icon: Icon, tone = 'neutral' }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{helper}</p>
      </div>
      <Icon size={20} strokeWidth={2.1} />
    </article>
  )
}

export function Panel({ title, icon: Icon, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-title">
        <Icon size={19} />
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  )
}

export function Meter({ label, value, color }) {
  // 非有限值（null/undefined/NaN/Infinity）走 暂无 + 0% 宽度，避免 NaN/undefined
  // 漏到 CSS width 与 <b> 文案；合法 0 仍渲染 0 + 0%。
  // 越界但有限的值（如 -10、150）夹到 [0, 100] 写入 CSS width，避免负宽度
  // 或撑破容器；<b> 文案仍保留原始数值。
  const finite = Number.isFinite(value)
  const width = finite ? Math.max(0, Math.min(value, 100)) : 0
  return (
    <div className="meter">
      <span>{label}</span>
      <div>
        <i style={{ width: `${width}%`, background: color }}></i>
      </div>
      <b>{finite ? value : '暂无'}</b>
    </div>
  )
}
