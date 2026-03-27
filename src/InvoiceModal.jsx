import React, { useRef, useState } from 'react'
import { X, Printer, Plus, Trash2 } from 'lucide-react'
import { IMEInput } from './IMEInput.jsx'

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString()
}

const INVOICE_SETTINGS_KEY = 'brightboard_invoice_settings'

export function getInvoiceSettings() {
  try {
    const raw = localStorage.getItem(INVOICE_SETTINGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveInvoiceSettings(settings) {
  try {
    localStorage.setItem(INVOICE_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // localStorage unavailable
  }
}

export function InvoiceSettingsPanel({ onBack }) {
  const [settings, setSettings] = useState(() => getInvoiceSettings())

  const update = (field, value) => {
    const next = { ...settings, [field]: value }
    setSettings(next)
    saveInvoiceSettings(next)
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-blue-600 hover:underline mb-2">
        &larr; 設定トップに戻る
      </button>
      <h3 className="text-sm font-semibold text-gray-700">請求書設定（インボイス）</h3>
      <p className="text-xs text-gray-500">ここで設定した情報が請求書に印字されます。この端末のローカルストレージに保存されます。</p>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">事業者名（屋号・会社名）</label>
          <IMEInput
            value={settings.companyName || ''}
            onChange={(v) => update('companyName', v)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            placeholder="例: 株式会社 清田自動車"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">適格請求書発行事業者 登録番号</label>
          <IMEInput
            value={settings.invoiceNumber || ''}
            onChange={(v) => update('invoiceNumber', v)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            placeholder="例: T1234567890123"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">住所</label>
          <IMEInput
            value={settings.address || ''}
            onChange={(v) => update('address', v)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            placeholder="例: 熊本県熊本市東区..."
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">電話番号</label>
          <IMEInput
            value={settings.phone || ''}
            onChange={(v) => update('phone', v)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            placeholder="例: 096-XXX-XXXX"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">振込先</label>
          <IMEInput
            component="textarea"
            value={settings.bankInfo || ''}
            onChange={(v) => update('bankInfo', v)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm resize-y min-h-[60px]"
            placeholder="例: 肥後銀行 ○○支店 普通 1234567 カ）キヨタジドウシャ"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">備考（請求書フッター）</label>
          <IMEInput
            component="textarea"
            value={settings.notes || ''}
            onChange={(v) => update('notes', v)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm resize-y min-h-[60px]"
            placeholder="例: お支払い期限: 請求書発行日より30日以内"
          />
        </div>
      </div>
    </div>
  )
}

export function InvoiceModal({ task, onClose }) {
  const printRef = useRef(null)
  const invoiceSettings = getInvoiceSettings()

  const [customerName, setCustomerName] = useState(task.assignee || '')

  const [items, setItems] = useState(() => {
    if (task.invoiceItems && task.invoiceItems.length > 0) {
      return task.invoiceItems
    }
    const taskLabel = [task.car, task.number].filter(Boolean).join(' ')
    return [
      {
        description: taskLabel ? `鈑金塗装修理 (${taskLabel})` : '鈑金塗装修理',
        quantity: 1,
        unit: '式',
        unitPrice: 0,
        taxRate: 10,
      },
    ]
  })

  const addItem = () => {
    setItems([...items, { description: '', quantity: 1, unit: '式', unitPrice: 0, taxRate: 10 }])
  }

  const removeItem = (idx) => {
    setItems(items.filter((_, i) => i !== idx))
  }

  const updateItem = (idx, field, value) => {
    setItems(items.map((item, i) => (i === idx ? { ...item, [field]: value } : item)))
  }

  // Calculate totals
  const taxGroups = {}
  items.forEach((item) => {
    const subtotal = (item.quantity || 0) * (item.unitPrice || 0)
    const rate = item.taxRate || 10
    if (!taxGroups[rate]) taxGroups[rate] = { subtotal: 0, tax: 0 }
    taxGroups[rate].subtotal += subtotal
    taxGroups[rate].tax += Math.floor(subtotal * rate / 100)
  })

  const totalExclTax = Object.values(taxGroups).reduce((s, g) => s + g.subtotal, 0)
  const totalTax = Object.values(taxGroups).reduce((s, g) => s + g.tax, 0)
  const totalInclTax = totalExclTax + totalTax

  const s = invoiceSettings || {}
  const invoiceNumber = `INV-${(task.inDate || '').replace(/-/g, '')}-${(task.id || '').slice(-4)}`
  const today = new Date()
  const issueDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`

  const handlePrint = () => {
    const printContent = printRef.current
    if (!printContent) return
    const win = window.open('', '_blank')
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>請求書 - ${invoiceNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif; font-size: 11px; color: #1e293b; padding: 20mm 15mm; }
          .invoice-container { max-width: 210mm; margin: 0 auto; }
          .invoice-title { font-size: 22px; font-weight: 700; text-align: center; margin-bottom: 24px; letter-spacing: 8px; }
          .header-grid { display: flex; justify-content: space-between; margin-bottom: 20px; }
          .header-left { flex: 1; }
          .header-right { flex: 1; text-align: right; }
          .customer-name { font-size: 16px; font-weight: 700; border-bottom: 2px solid #1e293b; padding-bottom: 4px; display: inline-block; margin-bottom: 8px; }
          .sama { font-size: 13px; font-weight: 400; margin-left: 8px; }
          .meta-label { color: #64748b; font-size: 10px; }
          .meta-value { font-size: 11px; margin-bottom: 2px; }
          .company-name { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
          .invoice-reg { font-size: 10px; color: #334155; margin-bottom: 2px; }
          .total-box { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 12px 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
          .total-label { font-size: 13px; font-weight: 600; }
          .total-amount { font-size: 20px; font-weight: 700; }
          .total-amount .yen { font-size: 13px; margin-right: 2px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
          th { background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 8px; font-size: 10px; font-weight: 600; color: #475569; text-align: center; }
          td { border: 1px solid #e2e8f0; padding: 6px 8px; font-size: 11px; }
          td.number { text-align: right; }
          td.center { text-align: center; }
          .tax-summary { margin-bottom: 16px; }
          .tax-summary table { width: auto; margin-left: auto; }
          .tax-summary th, .tax-summary td { font-size: 10px; padding: 4px 12px; }
          .totals-table { width: auto; margin-left: auto; margin-bottom: 20px; }
          .totals-table td { font-size: 11px; padding: 3px 12px; border: none; }
          .totals-table .label { text-align: right; color: #64748b; font-weight: 600; }
          .totals-table .grand { font-size: 13px; font-weight: 700; border-top: 2px solid #1e293b; padding-top: 4px; }
          .vehicle-info { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 12px; margin-bottom: 16px; font-size: 10px; color: #475569; }
          .vehicle-info span { margin-right: 16px; }
          .vehicle-info .label { font-weight: 600; color: #334155; }
          .notes { font-size: 9px; color: #94a3b8; margin-top: 20px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
          .reduced-mark { font-size: 9px; color: #dc2626; }
          @media print {
            body { padding: 10mm; }
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
      </body>
      </html>
    `)
    win.document.close()
    setTimeout(() => {
      win.print()
    }, 300)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl border border-slate-200 mx-4 max-h-[95vh] overflow-y-auto">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">請求書プレビュー（インボイス対応）</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white"
            >
              <Printer className="w-3.5 h-3.5" />
              印刷 / PDF保存
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Edit section - customer name */}
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <div className="mb-2">
            <label className="text-xs font-semibold text-slate-700 mr-2">宛名:</label>
            <IMEInput
              value={customerName}
              onChange={(v) => setCustomerName(v)}
              className="border border-gray-300 rounded px-2 py-1 text-sm w-64"
              placeholder="お客様名"
            />
          </div>
          <p className="text-xs font-semibold text-slate-700 mb-2">明細編集</p>
          <div className="space-y-1.5">
            {items.map((item, idx) => (
              <div key={idx} className="flex items-center gap-1.5 text-xs">
                <IMEInput
                  value={item.description}
                  onChange={(v) => updateItem(idx, 'description', v)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                  placeholder="作業内容"
                />
                <input
                  type="number"
                  value={item.quantity}
                  onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                  className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                  placeholder="数量"
                />
                <IMEInput
                  value={item.unit}
                  onChange={(v) => updateItem(idx, 'unit', v)}
                  className="w-12 border border-gray-300 rounded px-2 py-1 text-sm text-center"
                  placeholder="単位"
                />
                <input
                  type="number"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))}
                  className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                  placeholder="単価"
                />
                <select
                  value={item.taxRate}
                  onChange={(e) => updateItem(idx, 'taxRate', Number(e.target.value))}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value={10}>10%</option>
                  <option value={8}>8% (軽減)</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="p-1 text-slate-400 hover:text-red-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addItem}
            className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-500 font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            明細を追加
          </button>
        </div>

        {/* Invoice Preview */}
        <div className="p-6" ref={printRef}>
          <div className="invoice-container" style={{ maxWidth: '210mm', margin: '0 auto', fontFamily: '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif', fontSize: '11px', color: '#1e293b' }}>
            {/* Title */}
            <h1 style={{ fontSize: '22px', fontWeight: 700, textAlign: 'center', marginBottom: '24px', letterSpacing: '8px' }}>
              請 求 書
            </h1>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: 700, borderBottom: '2px solid #1e293b', paddingBottom: '4px', display: 'inline-block', marginBottom: '8px' }}>
                  {customerName || '（お客様名）'}
                  <span style={{ fontSize: '13px', fontWeight: 400, marginLeft: '8px' }}>様</span>
                </div>
                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                  下記の通りご請求申し上げます。
                </div>
              </div>
              <div style={{ flex: 1, textAlign: 'right' }}>
                <div style={{ fontSize: '10px', color: '#64748b' }}>請求書番号: {invoiceNumber}</div>
                <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '8px' }}>発行日: {issueDate}</div>
                <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '4px' }}>{s.companyName || '（事業者名未設定）'}</div>
                {s.invoiceNumber && (
                  <div style={{ fontSize: '10px', color: '#334155', marginBottom: '2px' }}>
                    登録番号: {s.invoiceNumber}
                  </div>
                )}
                {s.address && (
                  <div style={{ fontSize: '10px', color: '#475569', marginBottom: '1px' }}>{s.address}</div>
                )}
                {s.phone && (
                  <div style={{ fontSize: '10px', color: '#475569' }}>TEL: {s.phone}</div>
                )}
              </div>
            </div>

            {/* Total box */}
            <div style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '12px 16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>ご請求金額（税込）</span>
              <span style={{ fontSize: '20px', fontWeight: 700 }}>
                <span style={{ fontSize: '13px', marginRight: '2px' }}>&yen;</span>
                {formatNumber(totalInclTax)}
              </span>
            </div>

            {/* Vehicle info */}
            {(task.car || task.number || task.maker) && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '8px 12px', marginBottom: '16px', fontSize: '10px', color: '#475569' }}>
                {task.maker && (
                  <span style={{ marginRight: '16px' }}>
                    <span style={{ fontWeight: 600, color: '#334155' }}>メーカー: </span>{task.maker}
                  </span>
                )}
                {task.car && (
                  <span style={{ marginRight: '16px' }}>
                    <span style={{ fontWeight: 600, color: '#334155' }}>車種: </span>{task.car}
                  </span>
                )}
                {task.number && (
                  <span style={{ marginRight: '16px' }}>
                    <span style={{ fontWeight: 600, color: '#334155' }}>ナンバー: </span>{task.number}
                  </span>
                )}
                {task.colorNo && (
                  <span style={{ marginRight: '16px' }}>
                    <span style={{ fontWeight: 600, color: '#334155' }}>カラーNo: </span>{task.colorNo}
                  </span>
                )}
                {task.inDate && (
                  <span>
                    <span style={{ fontWeight: 600, color: '#334155' }}>入庫日: </span>{formatDate(task.inDate)}
                  </span>
                )}
              </div>
            )}

            {/* Items table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
              <thead>
                <tr>
                  <th style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', fontWeight: 600, color: '#475569', textAlign: 'center', width: '30px' }}>No.</th>
                  <th style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', fontWeight: 600, color: '#475569', textAlign: 'left' }}>摘要</th>
                  <th style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', fontWeight: 600, color: '#475569', textAlign: 'center', width: '50px' }}>数量</th>
                  <th style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', fontWeight: 600, color: '#475569', textAlign: 'center', width: '40px' }}>単位</th>
                  <th style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', fontWeight: 600, color: '#475569', textAlign: 'right', width: '80px' }}>単価</th>
                  <th style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', fontWeight: 600, color: '#475569', textAlign: 'right', width: '90px' }}>金額</th>
                  <th style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', fontWeight: 600, color: '#475569', textAlign: 'center', width: '50px' }}>税率</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const amount = (item.quantity || 0) * (item.unitPrice || 0)
                  return (
                    <tr key={idx}>
                      <td style={{ border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                      <td style={{ border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '11px' }}>
                        {item.description}
                        {item.taxRate === 8 && <span style={{ fontSize: '9px', color: '#dc2626', marginLeft: '4px' }}>※</span>}
                      </td>
                      <td style={{ border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{item.quantity}</td>
                      <td style={{ border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{item.unit}</td>
                      <td style={{ border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{formatNumber(item.unitPrice)}</td>
                      <td style={{ border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{formatNumber(amount)}</td>
                      <td style={{ border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{item.taxRate}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Tax summary */}
            <div style={{ marginBottom: '16px' }}>
              <table style={{ width: 'auto', marginLeft: 'auto', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '4px 12px', fontSize: '10px', fontWeight: 600, color: '#475569', textAlign: 'center' }}>税率</th>
                    <th style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '4px 12px', fontSize: '10px', fontWeight: 600, color: '#475569', textAlign: 'right' }}>対象額（税抜）</th>
                    <th style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '4px 12px', fontSize: '10px', fontWeight: 600, color: '#475569', textAlign: 'right' }}>消費税額</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(taxGroups).sort(([a], [b]) => Number(b) - Number(a)).map(([rate, group]) => (
                    <tr key={rate}>
                      <td style={{ border: '1px solid #e2e8f0', padding: '4px 12px', fontSize: '10px', textAlign: 'center' }}>
                        {rate}%{Number(rate) === 8 ? ' (軽減税率)' : ''}
                      </td>
                      <td style={{ border: '1px solid #e2e8f0', padding: '4px 12px', fontSize: '10px', textAlign: 'right' }}>&yen;{formatNumber(group.subtotal)}</td>
                      <td style={{ border: '1px solid #e2e8f0', padding: '4px 12px', fontSize: '10px', textAlign: 'right' }}>&yen;{formatNumber(group.tax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <table style={{ width: 'auto', marginLeft: 'auto', marginBottom: '20px', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '3px 12px', textAlign: 'right', color: '#64748b', fontWeight: 600, border: 'none' }}>小計（税抜）</td>
                  <td style={{ padding: '3px 12px', textAlign: 'right', border: 'none' }}>&yen;{formatNumber(totalExclTax)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 12px', textAlign: 'right', color: '#64748b', fontWeight: 600, border: 'none' }}>消費税額</td>
                  <td style={{ padding: '3px 12px', textAlign: 'right', border: 'none' }}>&yen;{formatNumber(totalTax)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 12px', textAlign: 'right', color: '#64748b', fontWeight: 600, fontSize: '13px', border: 'none', borderTop: '2px solid #1e293b', paddingTop: '6px' }}>合計（税込）</td>
                  <td style={{ padding: '3px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 700, border: 'none', borderTop: '2px solid #1e293b', paddingTop: '6px' }}>&yen;{formatNumber(totalInclTax)}</td>
                </tr>
              </tbody>
            </table>

            {/* Notes */}
            {items.some((item) => item.taxRate === 8) && (
              <div style={{ fontSize: '9px', color: '#64748b', marginBottom: '8px' }}>
                ※ 軽減税率（8%）対象品目
              </div>
            )}

            <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '20px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
              <p>本請求書は適格請求書（インボイス）として発行しています。</p>
              {s.bankInfo && (
                <p style={{ marginTop: '4px' }}>【振込先】{s.bankInfo}</p>
              )}
              {s.notes && (
                <p style={{ marginTop: '4px' }}>{s.notes}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
