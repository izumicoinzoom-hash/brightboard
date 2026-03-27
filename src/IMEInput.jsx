import React, { useRef, useCallback } from 'react'

/**
 * IME-safe input / textarea component.
 *
 * React の controlled component で日本語入力（IME）を使うと、
 * composition 中に onChange -> setState -> re-render が走り、
 * カーソル位置がずれたり文字化けする問題がある。
 *
 * このコンポーネントは onCompositionStart / onCompositionEnd を使って
 * IME 入力中は state 更新を抑制し、確定時にのみ onChange を呼ぶ。
 */
export function IMEInput({ value, onChange, component = 'input', ...rest }) {
  const composingRef = useRef(false)
  const Component = component

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true
  }, [])

  const handleCompositionEnd = useCallback(
    (e) => {
      composingRef.current = false
      onChange(e.target.value)
    },
    [onChange]
  )

  const handleChange = useCallback(
    (e) => {
      if (!composingRef.current) {
        onChange(e.target.value)
      }
    },
    [onChange]
  )

  return (
    <Component
      {...rest}
      value={value}
      onChange={handleChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    />
  )
}

export function IMETextarea(props) {
  return <IMEInput {...props} component="textarea" />
}
