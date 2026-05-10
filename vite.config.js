import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// ビルド毎に一意なバージョン文字列を生成。
// クライアント側ポーリングと比較して古いと判明したら更新バナーを出すために使う。
const buildVersion = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// dist/version.json を出力する vite プラグイン。
// ビルド完了後、`{ "version": "...", "builtAt": "..." }` の最小JSONを書く。
function writeVersionJsonPlugin() {
  return {
    name: 'bb-write-version-json',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(process.cwd(), 'dist')
      const payload = {
        version: buildVersion,
        builtAt: new Date().toISOString(),
      }
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(payload, null, 2))
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 本番は相対パスにし、index.html と assets を同じ階層に配置してデプロイする（スマホでの読み込み安定のため）
  const base = env.VITE_BASE_PATH || './'
  return {
    plugins: [react(), writeVersionJsonPlugin()],
    base,
    define: {
      __BB_BUILD_VERSION__: JSON.stringify(buildVersion),
    },
  }
})
