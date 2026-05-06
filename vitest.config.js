import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 仅用于组件层 SSR 测试。analysis 层的纯函数仍然走 node --test (test:unit)。
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.jsx'],
    environment: 'happy-dom',
  },
})
