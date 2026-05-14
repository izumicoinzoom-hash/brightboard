import React, { useEffect, useRef, useCallback } from 'react'
import { X, Undo2 } from 'lucide-react'

/**
 * RepairCancelledModal
 *
 * 修理中止フラグ確認モーダル。誤操作の救済を最優先とし、
 * - 背景クリック / Esc / 初期フォーカス = secondary (元に戻す)
 * - Enter / primary = 修理中止として記録 (破壊力高)
 * の二段構えで fail-safe を担保する。
 *
 * Props:
 *   open: boolean
 *   task: { assignee?, car?, number?, ... }
 *   remainingCount?: number     // バッチ処理時の残件数 (>1 で「まとめて中止」表示)
 *   onCancel: () => void        // 「修理中止として記録」
 *   onRevert: () => void        // 「誤操作。元の列に戻す」
 *   onCancelAll?: () => void    // 残り全部を修理中止 (バッチ)
 */
export function RepairCancelledModal({
  open,
  task,
  remainingCount,
  onCancel,
  onRevert,
  onCancelAll,
}) {
  const dialogRef = useRef(null)
  const secondaryBtnRef = useRef(null)
  const primaryBtnRef = useRef(null)
  const cancelAllBtnRef = useRef(null)

  const showCancelAll =
    typeof remainingCount === 'number' &&
    remainingCount > 1 &&
    typeof onCancelAll === 'function'

  // 初期フォーカス = secondary (誤操作) ボタン
  useEffect(() => {
    if (!open) return
    // 次フレームでフォーカス (mount 直後の transition と衝突しないように)
    const id = requestAnimationFrame(() => {
      secondaryBtnRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  // キーボードハンドラ: Esc → onRevert / Enter → onCancel / Tab → focus trap
  const handleKeyDown = useCallback(
    (e) => {
      if (!open) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onRevert?.()
        return
      }
      if (e.key === 'Enter') {
        // 入力フィールドは無いが、ボタン上での Enter はネイティブで click される。
        // ここでは「どのボタンにフォーカスがあっても primary を叩く」仕様は採らず、
        // フォーカス中のボタンを尊重するためデフォルト挙動に任せる。
        // ただしフォーカスがダイアログ本体(body)にある場合は onCancel を発火。
        const active = document.activeElement
        const isButton = active && active.tagName === 'BUTTON'
        if (!isButton) {
          e.preventDefault()
          onCancel?.()
        }
        return
      }
      if (e.key === 'Tab') {
        // focus trap: ダイアログ内のフォーカス可能要素間でループ
        const root = dialogRef.current
        if (!root) return
        const focusables = root.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [open, onRevert, onCancel]
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  // モーダル開閉時の body スクロールロック (BB他箇所の作法に合わせ最小限)
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  const handleOverlayMouseDown = (e) => {
    // 背景クリックは onRevert (fail-safe = 破壊力低側)
    if (e.target === e.currentTarget) {
      onRevert?.()
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-100"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="repair-cancelled-title"
        className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full transition-opacity duration-100"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2
          id="repair-cancelled-title"
          className="text-lg font-semibold text-slate-900 mb-3"
        >
          修理を中止として記録しますか？
        </h2>

        <p className="text-sm text-slate-600 mb-4">
          対象: <strong>{task?.assignee || '?'}</strong>
          {task?.car && ` / ${task.car}`}
          {task?.number && ` / ${task.number}`}
        </p>

        <div className="flex flex-col gap-4">
          <button
            ref={secondaryBtnRef}
            type="button"
            onClick={onRevert}
            className="h-14 w-full inline-flex items-center justify-center gap-2 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 transition-colors"
          >
            <Undo2 size={18} strokeWidth={1.75} />
            <span>誤操作だった（元の列に戻す）</span>
          </button>

          {showCancelAll && (
            <button
              ref={cancelAllBtnRef}
              type="button"
              onClick={onCancelAll}
              className="h-14 w-full inline-flex items-center justify-center gap-2 rounded-md bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 transition-colors"
            >
              <X size={18} strokeWidth={1.75} />
              <span>残り{remainingCount}件まとめて修理中止</span>
            </button>
          )}

          <button
            ref={primaryBtnRef}
            type="button"
            onClick={onCancel}
            className="h-14 w-full inline-flex items-center justify-center gap-2 rounded-md bg-rose-600 text-white hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 transition-colors"
          >
            <X size={18} strokeWidth={1.75} />
            <span>修理中止として記録</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default RepairCancelledModal
