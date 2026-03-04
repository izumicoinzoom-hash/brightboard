import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 本番は相対パスにし、index.html と assets を同じ階層に配置してデプロイする（スマホでの読み込み安定のため）
  const base = env.VITE_BASE_PATH || './'
  return {
    plugins: [react()],
    base,
  }
})