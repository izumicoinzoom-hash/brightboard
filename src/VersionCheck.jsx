import React, { useEffect, useState, useCallback } from 'react'

// ビルド時に vite.config.js の `define` から注入されるバージョン文字列。
// dev モードでは未定義の可能性があるためフォールバック。
// eslint-disable-next-line no-undef
const CURRENT_VERSION = typeof __BB_BUILD_VERSION__ !== 'undefined' ? __BB_BUILD_VERSION__ : 'dev'

const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5分ごと
const VERSION_URL = './version.json'

async function fetchLatestVersion() {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const json = await res.json()
    return typeof json.version === 'string' ? json.version : null
  } catch {
    return null
  }
}

export default function VersionCheck() {
  const [stale, setStale] = useState(false)

  const check = useCallback(async () => {
    if (CURRENT_VERSION === 'dev') return
    const latest = await fetchLatestVersion()
    if (latest && latest !== CURRENT_VERSION) {
      setStale(true)
    }
  }, [])

  useEffect(() => {
    check()
    const id = setInterval(check, POLL_INTERVAL_MS)
    const onFocus = () => check()
    const onVisibility = () => { if (document.visibilityState === 'visible') check() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [check])

  if (!stale) return null

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: '#fef3c7',
        borderBottom: '2px solid #f59e0b',
        color: '#78350f',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        fontSize: '14px',
        fontWeight: 600,
        boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <span style={{ flex: 1, lineHeight: 1.4 }}>
        🔄 新しいバージョンがあります。リロードしてください。
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          padding: '8px 16px',
          background: '#d97706',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          fontWeight: 700,
          fontSize: '14px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        いますぐ更新
      </button>
    </div>
  )
}
