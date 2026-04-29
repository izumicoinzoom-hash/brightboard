import React from 'react'

// onChange(event) → onChange(string) の変換のみを行う薄いラッパー。
// composition イベントの手動制御は禁止（React 18 内蔵処理に任せる）。
// 詳細・再発防止ガードは scripts/check-forbidden-patterns.mjs を参照。
export function IMEInput({ value, onChange, component = 'input', ...rest }) {
  const Component = component
  const handleChange = (e) => onChange(e.target.value)
  return <Component {...rest} value={value} onChange={handleChange} />
}

export function IMETextarea(props) {
  return <IMEInput {...props} component="textarea" />
}
