import { Component } from 'react'
import { ShieldAlert } from 'lucide-react'

// 计算崩溃时挡一层；不要让某个面板的异常把整个控制台拖崩。
// SSR 安全：只用 getDerivedStateFromError 设置状态，componentDidCatch 仅做客户端日志。
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
    this.handleReset = this.handleReset.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (typeof console !== 'undefined' && console.error) {
      const label = this.props.label ?? '未命名区域'
      console.error(`[ErrorBoundary] ${label} 渲染失败:`, error, info)
    }
  }

  handleReset() {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const { label = '当前面板', fallback } = this.props
    if (typeof fallback === 'function') {
      return fallback({ error, reset: this.handleReset })
    }

    return (
      <section className="data-alert danger" role="alert" aria-label={`${label}渲染异常`}>
        <ShieldAlert size={18} />
        <div>
          <strong>{label}渲染异常</strong>
          <p>{error.message || '未知错误，已隔离该区域。'}</p>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              marginTop: 6,
              padding: '4px 10px',
              border: '1px solid currentColor',
              borderRadius: 6,
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            重试渲染
          </button>
        </div>
      </section>
    )
  }
}
