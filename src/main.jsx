import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import VersionCheck from './VersionCheck.jsx'
import './index.css'

class RootErrorBoundary extends React.Component {
  state = { hasError: false, message: '' }
  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'エラーが発生しました' }
  }
  componentDidCatch(error, info) {
    if (typeof console !== 'undefined') console.error('RootErrorBoundary', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          fontFamily: 'sans-serif',
          background: '#f3f4f6',
          color: '#374151',
          boxSizing: 'border-box'
        }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>BrightBoard の読み込みに失敗しました</p>
          <p style={{ fontSize: 14, marginBottom: 16, maxWidth: 400 }}>{this.state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            再読み込み
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <VersionCheck />
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
)
