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
  return (
    <div className="meter">
      <span>{label}</span>
      <div>
        <i style={{ width: `${value}%`, background: color }}></i>
      </div>
      <b>{value}</b>
    </div>
  )
}
