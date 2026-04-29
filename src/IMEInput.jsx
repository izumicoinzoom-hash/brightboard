import React from 'react'

// onChange(event) → onChange(string) の変換のみを行う薄いラッパー。
// composition イベントは React 18 内蔵の処理に任せる。
// 2026-03-30 / 2026-04-30: composingRef 手動制御パターンは macOS Chrome IME と
// 競合し全入力不能になる事故を起こしたため、絶対に再導入しない。
export function IMEInput({ value, onChange, component = 'input', ...rest }) {
  const Component = component
  const handleChange = (e) => onChange(e.target.value)
  return <Component {...rest} value={value} onChange={handleChange} />
}

export function IMETextarea(props) {
  return <IMEInput {...props} component="textarea" />
}
