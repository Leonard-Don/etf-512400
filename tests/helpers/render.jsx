import { act } from 'react'
import { createRoot } from 'react-dom/client'

// Vitest + happy-dom 下的最小 React 渲染助手。
// 不引入 @testing-library/react，避免再增加一层依赖。
export function render(ui) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return {
    container,
    html: () => container.innerHTML,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}
