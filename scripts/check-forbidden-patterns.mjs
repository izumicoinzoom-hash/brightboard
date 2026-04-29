#!/usr/bin/env node
// BrightBoard 入力不能事故 再発防止ガード。
// 2026-03-30 / 2026-04-30 と同形の障害を二度と本番に出さないため、
// build / CI 前に forbidden パターンの混入を検出して exit 1 する。
//
// 1) composingRef: IME の compositionStart で onChange を抑制すると
//    macOS Chrome の IME と競合し、フラグが true で固まり全入力不能になる。
// 2) index.html への accounts.google.com/gsi/client 静的タグ:
//    非表示 iframe を生成し過去に問題を起こしたため、必要時に App.jsx で
//    動的ロードする方針。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

const RULES = [
  {
    name: 'composingRef (IME 手動制御)',
    pattern: /composingRef/,
    targets: ['src'],
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
  },
  {
    name: 'GIS 静的スクリプトタグ',
    pattern: /accounts\.google\.com\/gsi\/client/,
    targets: ['index.html'],
    extensions: ['.html'],
  },
]

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) yield* walk(p)
    else yield p
  }
}

let failed = false

for (const rule of RULES) {
  for (const target of rule.targets) {
    const abs = join(ROOT, target)
    let stat
    try {
      stat = statSync(abs)
    } catch {
      continue
    }
    const files = stat.isDirectory() ? [...walk(abs)] : [abs]
    for (const file of files) {
      if (!rule.extensions.some((ext) => file.endsWith(ext))) continue
      const text = readFileSync(file, 'utf8')
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (rule.pattern.test(lines[i])) {
          console.error(
            `\n[FORBIDDEN] ${rule.name}\n  ${relative(ROOT, file)}:${i + 1}: ${lines[i].trim()}`
          )
          failed = true
        }
      }
    }
  }
}

if (failed) {
  console.error('\nBrightBoard 禁止パターンが検出されました。修正してください。')
  console.error('参考: feedback_bb_no_external_scripts.md / 2026-03-30 入力不能事故\n')
  process.exit(1)
}
console.log('check-forbidden-patterns: OK')
