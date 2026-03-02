import React, { useState, useRef, useEffect } from 'react';
import {
  AlertTriangle, Search, Settings, Bell, ChevronDown, Layout,
  Car, PaintRoller, Wrench, X, FileText, CheckSquare, Paperclip, ChevronRight, Truck, Calendar, Link2
} from 'lucide-react';

// --- アプリ名（看板ボードのタイトルなどで使用）---
const APP_NAME = 'BrightBoard';

// --- ヘルパー関数 ---
const getTodayString = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatInOutDate = (inD, outD) => {
  const f = (d) => {
    if (!d) return '';
    const parts = d.split('-');
    if (parts.length !== 3) return d;
    return `${parts[1]}/${parts[2]}`;
  };
  const inStr = inD ? `IN${f(inD)}` : 'IN';
  const outStr = outD ? `OUT${f(outD)}` : 'OUT';
  return `${inStr} ${outStr}`;
};

// 添付ファイル: { type: 'pdf'|'image', name: string, data: string }（data は dataURL または画像URL）
const isImageType = (mime) => (mime || '').startsWith('image/');
const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

// --- 車両マスターデータ ---
const CAR_MODELS = {
  "トヨタ": ["アクア", "アルファード", "ヴェルファイア", "ヴォクシー", "カローラ", "カローラクロス", "カローラツーリング", "クラウン", "シエンタ", "ノア", "ハリアー", "プリウス", "ヤリス", "ヤリスクロス", "ライズ", "ランドクルーザー", "ランドクルーザープラド", "ルーミー", "RAV4", "C-HR", "86", "ハイエース", "プロボックス"],
  "レクサス": ["CT", "IS", "ES", "LS", "UX", "NX", "RX", "LX", "LC", "RC"],
  "日産": ["アリア", "エクストレイル", "オーラ", "キックス", "サクラ", "セレナ", "デイズ", "ノート", "マーチ", "リーフ", "ルークス", "GT-R", "フェアレディZ", "キャラバン", "エルグランド"],
  "ホンダ": ["アコード", "ヴェゼル", "オデッセイ", "シビック", "ステップワゴン", "フィット", "フリード", "N-BOX", "N-ONE", "N-WGN", "N-VAN", "ZR-V", "S660"],
  "マツダ": ["マツダ2", "マツダ3", "マツダ6", "CX-3", "CX-30", "CX-5", "CX-8", "CX-60", "ロードスター"],
  "スバル": ["インプレッサ", "クロストレック", "フォレスター", "レガシィ アウトバック", "レヴォーグ", "BRZ", "WRX"],
  "スズキ": ["アルト", "イグニス", "エブリイ", "クロスビー", "ジムニー", "ジムニーシエラ", "スイフト", "スペーシア", "ソリオ", "ハスラー", "ラパン", "ワゴンR"],
  "ダイハツ": ["アトレー", "ウェイク", "キャスト", "コペン", "タフト", "タント", "トール", "ハイゼット", "ブーン", "ミライース", "ムーヴ", "ムーヴキャンバス", "ロッキー"],
  "三菱": ["アウトランダーPHEV", "エクリプスクロス", "デリカD:5", "デリカミニ", "ミラージュ", "eKクロス", "eKワゴン"],
  "メルセデス・ベンツ": ["Aクラス", "Bクラス", "Cクラス", "Eクラス", "Sクラス", "Gクラス", "GLA", "GLB", "GLC", "GLE", "GLS", "CLA", "Vクラス"],
  "BMW": ["1シリーズ", "2シリーズ", "3シリーズ", "4シリーズ", "5シリーズ", "7シリーズ", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "Z4", "MINI"],
  "アウディ": ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q4", "Q5", "Q7", "Q8", "TT"],
  "フォルクスワーゲン": ["アップ！", "ポロ", "ゴルフ", "パサート", "T-Cross", "T-Roc", "ティグアン", "トゥアレグ", "ビートル"],
  "ポルシェ": ["911", "718ボクスター", "718ケイマン", "パナメーラ", "マカン", "カイエン", "タイカン"],
  "ボルボ": ["V40", "V60", "V90", "XC40", "XC60", "XC90"],
  "プジョー": ["208", "2008", "308", "3008", "508", "5008"],
  "ジープ": ["レネゲード", "コンパス", "チェロキー", "グランドチェロキー", "ラングラー"],
  "その他": ["その他車種（手入力）"]
};

// --- 担当者マスター ---
const RECEPTION_STAFF_OPTIONS = ['ログインユーザー']; // 受付担当者（ログインアカウントを先頭に表示する想定）
const BODY_STAFF_OPTIONS = ['木下', '竹馬', 'チャス', 'アビアン'];   // 板金担当者
const PAINT_STAFF_OPTIONS = ['野中', '小田', '佐藤', 'アグン', 'リズキ'];    // 塗装担当者

// --- 代車・レンタカー マスター ---
const LOANER_OPTIONS = [
  { id: 'none', label: '不要 (なし)' },
  { id: 'loaner_k', label: '代車 (軽自動車)' },
  { id: 'loaner_n', label: '代車 (普通車)' },
  { id: 'rental', label: 'レンタカー手配' }
];

// ガントチャート用 フリートデータ（社用車・レンタカー）
const FLEET_CARS = [
  { id: 'f1', name: 'N-BOX (熊本580あ1234)', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'f2', name: 'ミライース (熊本580い5678)', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'f3', name: 'アクア (熊本500う9012)', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'f4', name: 'ノート (熊本500え3456)', type: '普通車', status: 'maintenance', inspectionExpiry: '' },
  { id: 'r1', name: 'レンタカー枠 A', type: 'レンタカー', status: 'active', inspectionExpiry: '' },
  { id: 'r2', name: 'レンタカー枠 B', type: 'レンタカー', status: 'active', inspectionExpiry: '' },
];

// 車検満了日の3日前からは代車候補から除外する判定
const isFleetCarAvailableForToday = (car) => {
  if (!car || car.status !== 'active') return false;
  if (!car.inspectionExpiry) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(car.inspectionExpiry);
  if (Number.isNaN(exp.getTime())) return true;
  exp.setHours(0, 0, 0, 0);
  const diffDays = Math.round((exp - today) / (1000 * 60 * 60 * 24));
  // 車検満了日の3日前（diffDays < 3）から対象外
  return diffDays >= 3;
};

const INITIAL_RESERVATIONS = [
  { id: 'res1', carId: 'f1', taskId: 't1', taskName: '杉村 レクサス', start: '2026-02-28', end: '2026-03-04', color: 'bg-blue-400' },
  { id: 'res2', carId: 'f2', taskId: 't2', taskName: '下田 ワゴンR', start: '2026-03-03', end: '2026-03-08', color: 'bg-yellow-400' },
  { id: 'res3', carId: 'f3', taskId: 't3', taskName: '松永 ラパン', start: '2026-02-26', end: '2026-03-02', color: 'bg-gray-400' },
  { id: 'res4', carId: 'r1', taskId: 't4', taskName: '南 ノート', start: '2026-03-05', end: '2026-03-12', color: 'bg-red-400' },
];

// --- 利用可能なアイコン定義 ---
const AVAILABLE_CHARACTERS = [
  { id: 'car', icon: Car },
  { id: 'paint', icon: PaintRoller },
  { id: 'wrench', icon: Wrench }
];

const AVAILABLE_TASKS = [
  { id: 'check', icon: CheckSquare },
  { id: 'file', icon: FileText },
  { id: 'settings', icon: Settings }
];

// --- ボード設定データ（表示順: 入庫 → 全作業 → 鈑金 → 塗装 → 納車）---
// 列の statuses: 省略時は [id] として扱い、複数指定時はそのいずれかの status のタスクを表示。ドロップ時は statuses[0] に更新。
const BOARD_ORDER = ['planning', 'main', 'body', 'paint', 'delivery'];
const BOARDS = {
  planning: { id: 'planning', title: '〈入庫〉予約管理（Planning）', columns: [ { id: 'unscheduled', name: '入庫日未定' }, { id: 'mon', name: '月' }, { id: 'tue', name: '火' }, { id: 'wed', name: '水' }, { id: 'thu', name: '木' }, { id: 'fri', name: '金' }, { id: 'sat', name: '土' }, { id: 'sun', name: '日' }, { id: 'received', name: '入庫済み' }, ] },
  // 全作業 ⇔ 塗装: 下処理＆塗装＝塗装の下処理・下処理済P待ち・塗装を統合。Pのみ＝p_only。磨き・作業完了はそのまま。
  main: { id: 'main', title: '〈全作業〉工程管理（Main）', columns: [
    { id: 'received', name: '入庫済み' },
    { id: 'b_wait', name: 'B待ち' },
    { id: 'b_doing', name: 'B中' },
    { id: 'b_done_p_wait', name: 'B完了 P待ち' },
    { id: 'p_only', name: 'Pのみ', statuses: ['p_only', 'prep'] },
    { id: 'prep_paint', name: '下処理＆塗装', statuses: ['prep_done', 'painting', 'prep_p', 'assembly_wait'] },
    { id: 'assembly', name: '組付け' },
    { id: 'polish', name: '磨き', statuses: ['polish', 'polishing'] },
    { id: 'completed', name: '作業完了', statuses: ['completed', 'assembly_done_both', 'assembly_done_nuri', 'polish_done'] },
    { id: 'delivery_today', name: '本日納車', statuses: ['delivery_wait', 'delivery_today'] },
  ] },
  body: { id: 'body', title: '〈鈑金〉工程管理（Body）', columns: [ { id: 'b_wait', name: '鈑金 (Waiting)' }, { id: 'b_doing', name: '鈑金中' }, { id: 'b_done_p_wait', name: '鈑金完了 P待ち' }, { id: 'assembly', name: '組付け' }, { id: 'assembly_done_both', name: '組付完了 (磨無 & 磨完了)', statuses: ['completed', 'assembly_done_both'] }, { id: 'assembly_done_nuri', name: '組付完了 (磨無)', statuses: ['completed', 'assembly_done_nuri'] }, ] },
  paint: { id: 'paint', title: '〈塗装〉工程管理（Paint）', columns: [ { id: 'prep', name: '下処理', statuses: ['prep', 'b_done_p_wait'] }, { id: 'prep_done', name: '下処理済 (P待ち)' }, { id: 'painting', name: '塗装' }, { id: 'assembly_wait', name: '組付け待ち' }, { id: 'polishing', name: '磨き' }, { id: 'polish_done', name: '磨き完了', statuses: ['completed', 'polish_done'] }, ] },
  delivery: { id: 'delivery', title: '〈納車〉管理（Delivery）', columns: [ { id: 'delivery_wait', name: '納車待ち' }, { id: 'delivery_today', name: '本日納車' }, { id: 'delivered_unpaid', name: '納車済み-支払い待ち' }, { id: 'delivered_paid', name: '納車済-支払い済み' }, { id: 'completed', name: '完了' }, ] }
};

const LINK_CONFIG_KEY = 'brightboard_column_statuses';
const CALENDAR_PENDING_KEY = 'brightboard_calendar_pending';

function buildInitialColumnStatuses() {
  const out = {};
  BOARD_ORDER.forEach(bid => {
    const board = BOARDS[bid];
    if (!board || !Array.isArray(board.columns)) return;
    out[bid] = {};
    board.columns.forEach(col => {
      if (col && col.id) out[bid][col.id] = Array.isArray(col.statuses) ? [...col.statuses] : [col.id];
    });
  });
  return out;
}

// --- モックデータ ---
const INITIAL_TASKS = [
  {
    id: 't1', status: 'received', color: 'bg-white',
    car: 'レクサス', number: '501', assignee: 'T 個人 杉村',
    inDate: '2026-02-11', outDate: '', loanerType: 'none', dots: ['red', 'white', 'white', 'white'],
    characters: ['car', 'paint'], tasks: ['check'],
    statusEnteredAt: new Date().toISOString(),
    statusHistory: []
  },
  {
    id: 't2', status: 'received', color: 'bg-blue-400',
    car: 'ワゴンR', number: 'R223', assignee: 'あ 下田',
    inDate: '2026-02-18', outDate: '2026-02-19', loanerType: 'loaner_k', dots: ['blue', 'blue', 'blue', 'blue'],
    characters: ['car'], tasks: [],
    statusEnteredAt: new Date().toISOString(),
    statusHistory: []
  },
  {
    id: 't3', status: 'b_wait', color: 'bg-yellow-300',
    car: 'ラパン', number: '853', assignee: '米 T 松永',
    inDate: '2026-02-27', outDate: '', loanerType: 'loaner_k', dots: ['yellow', 'yellow', 'white', 'white'],
    characters: ['wrench'], tasks: ['file'],
    statusEnteredAt: new Date().toISOString(),
    statusHistory: []
  },
  {
    id: 't4', status: 'b_doing', color: 'bg-white',
    car: 'ノート', number: '2554', assignee: 'あ 南',
    inDate: '2026-02-14', outDate: '2026-02-15', loanerType: 'rental', dots: ['red', 'yellow', 'white', 'white'],
    characters: [], tasks: ['settings'],
    statusEnteredAt: new Date().toISOString(),
    statusHistory: []
  },
  {
    id: 't5', status: 'prep_p', color: 'bg-blue-400',
    car: 'ムーブ', number: '3824', assignee: 'T ソニー 富田',
    inDate: '2026-02-10', outDate: '2026-02-20', loanerType: 'none', dots: ['white', 'white', 'blue', 'white'],
    characters: ['paint'], tasks: [],
    statusEnteredAt: new Date().toISOString(),
    statusHistory: []
  },
];

// --- 共通コンポーネント ---
const Button = ({ children, className = '', variant = 'primary', ...props }) => {
  const baseStyle = "px-4 py-2 rounded text-sm font-medium transition-colors";
  const variants = {
    primary: "bg-[#0052cc] hover:bg-[#0047b3] text-white",
    secondary: "bg-gray-100 hover:bg-gray-200 text-gray-700",
    text: "hover:bg-gray-100 text-gray-600"
  };
  return <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>{children}</button>;
};

function useOutsideClick(ref, callback) {
  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) callback();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [ref, callback]);
}

// --- ログイン画面 ---
function LoginScreen({ onLogin }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-8 rounded shadow-sm border border-gray-200">
        <h1 className="text-2xl font-bold text-center mb-6 text-gray-800">ログイン</h1>
        <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-8 flex items-start gap-3">
          <AlertTriangle className="text-orange-500 w-5 h-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-700">このページにアクセスするにはログインする必要があります。</p>
        </div>
        <div className="space-y-4">
          <button onClick={onLogin} className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 rounded px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm">
            <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Googleでログイン
          </button>
        </div>
      </div>
    </div>
  );
}

const FLEET_TYPE_OPTIONS = ['軽自動車', '普通車', 'レンタカー'];

// --- 代車ガントチャートコンポーネント ---
function LoanerGanttChart({ fleetCars, setFleetCars, reservations, setReservations, onReservationUpdate, setTasks }) {
  const [draggedRes, setDraggedRes] = useState(null);
  const [resizingResId, setResizingResId] = useState(null);
  const [newCarName, setNewCarName] = useState('');
  const [newCarType, setNewCarType] = useState('軽自動車');
  const [isScheduleExpanded, setIsScheduleExpanded] = useState(true);
  const [viewOffsetDays, setViewOffsetDays] = useState(0); // 0=今日付近、正=先の日付へ
  const resizeDataRef = useRef({ res: null, timelineRect: null });

  const today = new Date();
  const daysRange = 14; // 2週間分表示
  const viewStartOffset = -3; // 表示開始を今日の3日前から
  const dates = Array.from({ length: daysRange }).map((_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + viewStartOffset + viewOffsetDays + i);
    return d;
  });

  const startDateStr = dates[0].toISOString().split('T')[0];

  const goToToday = () => setViewOffsetDays(0);
  const goPrev = () => setViewOffsetDays((prev) => Math.max(viewStartOffset, prev - 7));
  const goNext = () => setViewOffsetDays((prev) => Math.min(60, prev + 7)); // 約2ヶ月先まで

  const formatDateLocal = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const getDaysDiff = (start, end) => {
    const s = new Date(start);
    const e = new Date(end);
    return Math.floor((e - s) / (1000 * 60 * 60 * 24));
  };

  const handleResizeStart = (e, res) => {
    e.stopPropagation();
    e.preventDefault();
    const timeline = e.currentTarget.closest('[data-timeline-row]');
    if (!timeline) return;
    const timelineRect = timeline.getBoundingClientRect();
    resizeDataRef.current = { res, timelineRect };
    setResizingResId(res.id);
  };

  useEffect(() => {
    if (!resizingResId) return;
    const handleMouseMove = (e) => {
      const { res, timelineRect } = resizeDataRef.current;
      if (!res || !timelineRect) return;
      const dayWidth = timelineRect.width / daysRange;
      const dayIndex = (e.clientX - timelineRect.left) / dayWidth;
      const startOffsetDays = getDaysDiff(startDateStr, res.start);
      const minEndDayIndex = startOffsetDays + 1;
      const endDayIndex = Math.max(minEndDayIndex, Math.min(daysRange - 1, Math.round(dayIndex)));
      const newEndDate = new Date(dates[0]);
      newEndDate.setDate(newEndDate.getDate() + endDayIndex);
      const newEndStr = formatDateLocal(newEndDate);
      if (newEndStr === res.end) return;
      const updated = { ...res, end: newEndStr };
      if (onReservationUpdate) onReservationUpdate(updated); else setReservations(prev => prev.map(r => r.id === res.id ? updated : r));
    };
    const handleMouseUp = () => {
      setResizingResId(null);
      resizeDataRef.current = { res: null, timelineRect: null };
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingResId, startDateStr, daysRange, dates, setReservations]);

  const handleDragStart = (e, res) => {
    setDraggedRes(res);
    e.dataTransfer.effectAllowed = 'move';

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const durationDays = getDaysDiff(res.start, res.end) + 1;
    const dayWidth = rect.width / durationDays;
    const offsetDays = Math.floor(offsetX / dayWidth);
    e.dataTransfer.setData('text/plain', offsetDays.toString());
  };

  const handleRowDrop = (e, targetCarId) => {
    e.preventDefault();
    if (!draggedRes) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const dayWidth = rect.width / daysRange;
    const dropDayIndex = Math.floor(offsetX / dayWidth);

    const offsetDays = parseInt(e.dataTransfer.getData('text/plain') || '0', 10);
    const startDayIndex = dropDayIndex - offsetDays;

    const duration = getDaysDiff(draggedRes.start, draggedRes.end);

    const newStartDate = new Date(dates[0]);
    newStartDate.setDate(newStartDate.getDate() + startDayIndex);

    const newEndDate = new Date(newStartDate);
    newEndDate.setDate(newEndDate.getDate() + duration);

    const updatedRes = {
      ...draggedRes,
      carId: targetCarId,
      start: formatDateLocal(newStartDate),
      end: formatDateLocal(newEndDate)
    };
    if (onReservationUpdate) onReservationUpdate(updatedRes); else setReservations(reservations.map(r => r.id === updatedRes.id ? updatedRes : r));
    setDraggedRes(null);
  };

  const handleAddVehicle = () => {
    if (!newCarName.trim()) return;
    const id = `f${Date.now()}`;
    setFleetCars(prev => [...prev, { id, name: newCarName.trim(), type: newCarType, status: 'active' }]);
    setNewCarName('');
  };

  const handleRemoveVehicle = (car) => {
    const hasRes = reservations.some(r => r.carId === car.id);
    if (hasRes && !window.confirm(`「${car.name}」に予約が入っています。削除すると予約も解除され、紐づくカードの代車情報もクリアされます。削除しますか？`)) return;
    setFleetCars(prev => prev.filter(c => c.id !== car.id));
    if (hasRes) {
      setReservations(prev => prev.filter(r => r.carId !== car.id));
      if (setTasks) setTasks(prev => prev.map(t => t.loanerCarId === car.id ? { ...t, loanerCarId: '', loanerType: 'none' } : t));
    }
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Truck className="w-6 h-6 text-blue-600" />
            代車・レンタカー 貸出状況
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            車両ごとの予約状況と空き状況を管理します。車両の登録・削除は左下の歯車「代車マスタ設定」から行ってください。
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Button variant="secondary" onClick={goToToday}>今日</Button>
          <Button variant="secondary" onClick={goPrev}>&lt;</Button>
          <Button variant="secondary" onClick={goNext}>&gt;</Button>
        </div>
      </div>

      <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50">
        <button type="button" onClick={() => setIsScheduleExpanded(!isScheduleExpanded)} className="w-full px-6 py-3 flex items-center gap-2 text-left hover:bg-gray-100 transition-colors">
          <ChevronRight className={`w-5 h-5 text-gray-500 flex-shrink-0 transition-transform ${isScheduleExpanded ? 'rotate-90' : ''}`} />
          <span className="font-semibold text-gray-700">貸出日程</span>
          {!isScheduleExpanded && <span className="text-sm text-gray-500">（クリックで展開）</span>}
        </button>
      </div>

      {isScheduleExpanded && (
      <div className="flex-1 overflow-auto p-4 min-h-0">
        <div className="min-w-max border border-gray-200 rounded shadow-sm bg-white">
          <div className="flex border-b border-gray-200 bg-gray-100 sticky top-0 z-10">
            <div className="w-48 flex-shrink-0 p-3 font-semibold text-gray-700 border-r border-gray-200 bg-gray-100 sticky left-0 z-20">
              車両
            </div>
            <div className="flex flex-1">
              {dates.map((d, i) => {
                const isToday = d.toDateString() === today.toDateString();
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div key={i} className={`flex-1 min-w-[60px] p-2 text-center text-xs border-r border-gray-200 ${isToday ? 'bg-blue-100 font-bold text-blue-700' : isWeekend ? 'bg-gray-50' : ''}`}>
                    <div className="text-gray-500">{d.getMonth() + 1}/{d.getDate()}</div>
                    <div>{['日', '月', '火', '水', '木', '金', '土'][d.getDay()]}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {fleetCars.map(car => (
            <div key={car.id} className="flex border-b border-gray-200 relative hover:bg-gray-50 group">
              <div className="w-48 flex-shrink-0 p-3 border-r border-gray-200 bg-white group-hover:bg-gray-50 sticky left-0 z-10 flex flex-col justify-between">
                <div>
                  <div className="text-sm font-bold text-gray-800 truncate" title={car.name}>{car.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{car.type}</div>
                </div>
              </div>

              <div
                className="flex flex-1 relative"
                data-timeline-row
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={(e) => handleRowDrop(e, car.id)}
              >
                {dates.map((d, i) => (
                  <div key={i} className={`flex-1 min-w-[60px] border-r border-gray-200 ${d.getDay() === 0 || d.getDay() === 6 ? 'bg-gray-50/50' : ''}`}></div>
                ))}

                {reservations.filter(r => r.carId === car.id).map(res => {
                  const startOffsetDays = getDaysDiff(startDateStr, res.start);
                  const durationDays = getDaysDiff(res.start, res.end) + 1;

                  const actualStart = Math.max(0, startOffsetDays);
                  const actualEnd = Math.min(daysRange, startOffsetDays + durationDays);
                  if (actualEnd <= 0 || actualStart >= daysRange) return null;

                  const leftPct = (actualStart / daysRange) * 100;
                  const widthPct = ((actualEnd - actualStart) / daysRange) * 100;

                  return (
                    <div
                      key={res.id}
                      className="absolute top-2 bottom-2 flex rounded-md"
                      style={{ left: `${leftPct}%`, width: `${widthPct}%`, zIndex: 5 }}
                    >
                      <div
                        draggable
                        onDragStart={(e) => handleDragStart(e, res)}
                        onDragEnd={() => setDraggedRes(null)}
                        className={`flex-1 min-w-0 rounded-l-md shadow-sm flex items-center px-2 text-xs font-semibold truncate cursor-grab active:cursor-grabbing border border-black/10 rounded-r-none ${res.color} ${draggedRes?.id === res.id ? 'opacity-50' : 'hover:brightness-95'}`}
                        title={`${res.taskName} (${res.start} ~ ${res.end})`}
                      >
                        {res.taskName}
                      </div>
                      <div
                        role="button"
                        tabIndex={0}
                        className={`w-2 flex-shrink-0 rounded-r-md border border-black/10 border-l-0 cursor-ew-resize bg-black/10 hover:bg-blue-400/30 ${res.color} ${resizingResId === res.id ? 'ring-1 ring-blue-500' : ''}`}
                        title="右にドラッグで期間を延長"
                        onMouseDown={(e) => handleResizeStart(e, res)}
                        onDragStart={(e) => e.preventDefault()}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

// --- リンク設定パネル（ドラッグ＆ドロップで列同士をリンク）---
function LinkConfigPanel({ columnStatuses, setColumnStatuses, onBack }) {
  const [draggedLink, setDraggedLink] = useState(null);
  const [expandedBoards, setExpandedBoards] = useState(() => {
    const initial = {};
    BOARD_ORDER.forEach(bid => {
      initial[bid] = bid === 'main' || bid === 'body' || bid === 'paint';
    });
    return initial;
  });

  const getStatuses = (boardId, colId) => {
    const list = columnStatuses?.[boardId]?.[colId];
    if (Array.isArray(list) && list.length) return list;
    const col = BOARDS[boardId]?.columns?.find(c => c.id === colId);
    const def = Array.isArray(col?.statuses) ? col.statuses : [colId];
    return def || [colId];
  };

  const getPrimary = (boardId, colId) => getStatuses(boardId, colId)[0] || colId;

  const addLink = (targetBoardId, targetColId, statusToAdd) => {
    setColumnStatuses(prev => {
      const board = prev[targetBoardId] || {};
      const fallback = BOARDS[targetBoardId]?.columns?.find(c => c.id === targetColId)?.statuses ?? [targetColId];
      const list = board[targetColId] && board[targetColId].length ? board[targetColId] : fallback;
      if (list.includes(statusToAdd)) return prev;
      return { ...prev, [targetBoardId]: { ...board, [targetColId]: [...list, statusToAdd] } };
    });
  };

  const removeLink = (boardId, colId, statusToRemove) => {
    setColumnStatuses(prev => {
      const board = prev[boardId] || {};
      const base = board[colId];
      const fallback = BOARDS[boardId]?.columns?.find(c => c.id === colId)?.statuses ?? [colId];
      const list = (base && base.length ? base : fallback).filter(s => s !== statusToRemove);
      const next = list.length ? list : [colId];
      return { ...prev, [boardId]: { ...board, [colId]: next } };
    });
  };

  const handleLinkDragStart = (e, boardId, colId) => {
    setDraggedLink({ boardId, colId });
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/json', JSON.stringify({ boardId, colId }));
    e.dataTransfer.setData('text/plain', `${boardId}:${colId}`);
  };

  const handleLinkDragEnd = () => setDraggedLink(null);

  const handleLinkDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };

  const handleLinkDrop = (e, targetBoardId, targetColId) => {
    e.preventDefault();
    setDraggedLink(null);
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    const isMove = e.altKey || e.shiftKey;
    try {
      const { boardId, colId } = JSON.parse(raw);
      const primary = getPrimary(boardId, colId);
      addLink(targetBoardId, targetColId, primary);
      if (isMove) {
        removeLink(boardId, colId, primary);
      }
    } catch (_) {}
  };

  const boardLabels = { planning: '入庫', main: '全作業', body: '鈑金', paint: '塗装', delivery: '納車' };

  const resetToDefault = () => { if (window.confirm('リンクを初期状態に戻しますか？')) setColumnStatuses(buildInitialColumnStatuses()); };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={onBack} className="text-sm text-blue-600 hover:underline">← 設定に戻る</button>
        <button type="button" onClick={resetToDefault} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100">デフォルトに戻す</button>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        列をドラッグして別の列にドロップすると、ドロップ先の列にその status がリンクされ、同じカードが両方に表示されます。
        Alt（または Shift）キーを押しながらドロップすると、リンクを「移動」し、元の列からはその status のリンクだけが外れます。
        ボード名をクリックすると、その看板のリンク一覧を折りたたみ・展開できます。リンク横の × で個別に解除できます。
      </p>
      <div className="space-y-6">
        {BOARD_ORDER.map(bid => {
          const board = BOARDS[bid];
          if (!board) return null;
          const isExpanded = expandedBoards[bid] ?? true;
          return (
            <div key={bid} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedBoards(prev => ({ ...prev, [bid]: !isExpanded }))}
                className="w-full px-3 py-2 bg-gray-100 font-medium text-gray-800 text-sm flex items-center justify-between hover:bg-gray-200"
              >
                <span className="flex items-center gap-1">
                  <ChevronRight className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  {boardLabels[bid] || board.title}
                </span>
              </button>
              {isExpanded && (
                <div className="divide-y divide-gray-100">
                  {board.columns.map(col => {
                    const statuses = getStatuses(bid, col.id);
                    const isDragging = draggedLink?.boardId === bid && draggedLink?.colId === col.id;
                    return (
                      <div
                        key={col.id}
                        draggable
                        onDragStart={(e) => handleLinkDragStart(e, bid, col.id)}
                        onDragEnd={handleLinkDragEnd}
                        onDragOver={handleLinkDragOver}
                        onDrop={(e) => handleLinkDrop(e, bid, col.id)}
                        className={`px-3 py-2 flex flex-wrap items-center gap-2 cursor-grab active:cursor-grabbing border-l-4 ${isDragging ? 'opacity-50 border-blue-400 bg-blue-50' : 'border-transparent hover:bg-gray-50'}`}
                      >
                        <span className="text-sm font-medium text-gray-700 min-w-[120px]">{col.name}</span>
                        <span className="text-xs text-gray-400">←</span>
                        <div className="flex flex-wrap gap-1">
                          {statuses.map(s => (
                            <span key={s} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-gray-200 text-xs text-gray-700">
                              {s}
                              <button type="button" onClick={() => removeLink(bid, col.id, s)} className="ml-0.5 rounded hover:bg-red-200 text-gray-500 hover:text-red-700 p-0.5" title="リンク解除">×</button>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// --- 代車マスタ設定パネル ---
function FleetMasterPanel({ fleetCars, setFleetCars, reservations, setReservations, setTasks, onBack }) {
  const [newCarName, setNewCarName] = useState('');
  const [newCarType, setNewCarType] = useState(FLEET_TYPE_OPTIONS[0]);

  const handleAdd = () => {
    if (!newCarName.trim()) return;
    const id = `f${Date.now()}`;
    setFleetCars(prev => [...prev, { id, name: newCarName.trim(), type: newCarType, status: 'active', inspectionExpiry: '' }]);
    setNewCarName('');
  };

  const handleRemove = (car) => {
    const hasRes = reservations.some(r => r.carId === car.id);
    if (hasRes && !window.confirm(`「${car.name}」に予約が入っています。削除すると予約も解除され、紐づくカードの代車情報もクリアされます。削除しますか？`)) return;
    setFleetCars(prev => prev.filter(c => c.id !== car.id));
    if (hasRes) {
      setReservations(prev => prev.filter(r => r.carId !== car.id));
      if (setTasks) setTasks(prev => prev.map(t => t.loanerCarId === car.id ? { ...t, loanerCarId: '', loanerType: 'none' } : t));
    }
  };

  const handleStatusChange = (carId, status) => {
    setFleetCars(prev => prev.map(c => c.id === carId ? { ...c, status } : c));
  };

  const handleExpiryChange = (carId, value) => {
    setFleetCars(prev => prev.map(c => c.id === carId ? { ...c, inspectionExpiry: value } : c));
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={onBack} className="text-sm text-blue-600 hover:underline">← 設定に戻る</button>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        代車・レンタカーの車両を追加・削除・ステータス変更できます。ここでの変更は代車ガントチャートとカード作成時の車両選択にも反映されます。
      </p>

      <div className="mb-6 space-y-2">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">車両の追加</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-56"
            placeholder="車両名（例: N-BOX 熊本580あ1234）"
            value={newCarName}
            onChange={(e) => setNewCarName(e.target.value)}
          />
          <select
            className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
            value={newCarType}
            onChange={(e) => setNewCarType(e.target.value)}
          >
            {FLEET_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            type="button"
            onClick={handleAdd}
            className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            車両を追加
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">登録済み車両</div>
        <div className="border border-gray-200 rounded-lg max-h-[340px] overflow-y-auto divide-y divide-gray-100">
          {fleetCars.map(car => (
            <div key={car.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate" title={car.name}>{car.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">{car.type}</div>
              </div>
              <div className="flex flex-col items-end gap-1 mr-2">
                <span className="text-[10px] text-gray-500">車検満了日</span>
                <input
                  type="date"
                  className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                  value={car.inspectionExpiry || ''}
                  onChange={(e) => handleExpiryChange(car.id, e.target.value)}
                />
              </div>
              <select
                className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                value={car.status || 'active'}
                onChange={(e) => handleStatusChange(car.id, e.target.value)}
              >
                <option value="active">稼働中</option>
                <option value="maintenance">整備中</option>
                <option value="inactive">使用停止</option>
              </select>
              <button
                type="button"
                onClick={() => handleRemove(car)}
                className="text-xs text-red-600 hover:underline"
              >
                削除
              </button>
            </div>
          ))}
          {fleetCars.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">登録されている車両はありません。</div>
          )}
        </div>
      </div>
    </>
  );
}

// --- カレンダー用リンクモーダル（入庫予定→BrightBoardカード作成リンクを発行）---
function CalendarLinkModal({ onClose }) {
  const [assignee, setAssignee] = useState('');
  const [car, setCar] = useState('');
  const [number, setNumber] = useState('');
  const [inDate, setInDate] = useState(getTodayString());
  const [inTime, setInTime] = useState('09:00');
  const [imageUrl, setImageUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const params = new URLSearchParams({
      fromCalendar: '1',
      assignee: assignee || '（顧客名）',
      car: car || '（車種）',
      number: number || '（ナンバー）',
      inDate: inDate || getTodayString(),
      inTime: inTime || '09:00'
    });
    if (imageUrl && imageUrl.trim()) params.set('imageUrl', imageUrl.trim());
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            カレンダー用リンク（入庫→カード作成）
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-4 space-y-4 text-sm">
          <p className="text-gray-600">
            入庫予定の情報を入力し「リンクをコピー」を押すと、Googleカレンダーの予定の説明や場所に貼れるURLがコピーされます。予定からそのリンクを開くと、BrightBoardに飛び、この内容でカードが1件自動作成されます。
          </p>
          <div>
            <label className="block text-gray-700 font-medium mb-1">お客様名</label>
            <input type="text" className="w-full border border-gray-300 rounded px-3 py-2" placeholder="例: 山田 太郎" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-1">車種</label>
            <input type="text" className="w-full border border-gray-300 rounded px-3 py-2" placeholder="例: ノート" value={car} onChange={(e) => setCar(e.target.value)} />
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-1">ナンバー</label>
            <input type="text" className="w-full border border-gray-300 rounded px-3 py-2" placeholder="例: 熊本500あ1234" value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-gray-700 font-medium mb-1">入庫日</label>
              <input type="date" className="w-full border border-gray-300 rounded px-3 py-2" value={inDate} onChange={(e) => setInDate(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="block text-gray-700 font-medium mb-1">入庫時刻</label>
              <input type="time" className="w-full border border-gray-300 rounded px-3 py-2" value={inTime} onChange={(e) => setInTime(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-1">画像URL（カレンダー添付写真を入庫カードの添付に）</label>
            <input type="url" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" placeholder="例: https://... カレンダー予定に添付した写真のURL" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
            <p className="text-xs text-gray-500 mt-1">予定に添付した写真のURLを貼ると、作成されるカードの添付ファイルになります。</p>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={handleCopy} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
              <Link2 className="w-4 h-4" />
              {copied ? 'コピーしました' : 'リンクをコピー'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-3 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">閉じる</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- メインアプリ画面 ---
function KanbanApp({ currentUser = 'ログインユーザー' }) {
  const [currentView, setCurrentView] = useState('board');
  const [currentBoardId, setCurrentBoardId] = useState('main');
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [reservations, setReservations] = useState(INITIAL_RESERVATIONS);
  const [fleetCars, setFleetCars] = useState([...FLEET_CARS]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCalendarLinkModalOpen, setIsCalendarLinkModalOpen] = useState(false);
  const [calendarToast, setCalendarToast] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isSearchMenuOpen, setIsSearchMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLinkSettingsOpen, setIsLinkSettingsOpen] = useState(false);
  const [isFleetSettingsOpen, setIsFleetSettingsOpen] = useState(false);
  const [columnStatuses, setColumnStatuses] = useState(() => {
    const fallback = buildInitialColumnStatuses();
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LINK_CONFIG_KEY) : null;
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
      const init = buildInitialColumnStatuses();
      Object.keys(init).forEach(bid => {
        if (parsed[bid] && typeof parsed[bid] === 'object' && !Array.isArray(parsed[bid]))
          Object.keys(init[bid] || {}).forEach(cid => {
            const arr = parsed[bid][cid];
            if (Array.isArray(arr) && arr.length > 0) init[bid][cid] = arr;
          });
      });
      return init;
    } catch (_) {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined' && columnStatuses) localStorage.setItem(LINK_CONFIG_KEY, JSON.stringify(columnStatuses));
    } catch (_) {}
  }, [columnStatuses]);
  const [searchFilters, setSearchFilters] = useState({
    assignee: '', maker: '', car: '', receptionStaff: '', bodyStaff: '', paintStaff: '', number: '', color: ''
  });

  const headerMenuRef = useRef(null);
  const projectMenuRef = useRef(null);
  const searchMenuRef = useRef(null);

  useOutsideClick(headerMenuRef, () => setIsHeaderMenuOpen(false));
  useOutsideClick(projectMenuRef, () => setIsProjectMenuOpen(false));
  useOutsideClick(searchMenuRef, () => setIsSearchMenuOpen(false));

  // カレンダーリンクから入庫カードを1件作成（URL or sessionStorage の fromCalendar パラメータ）
  const createCardFromCalendarParams = React.useCallback((params) => {
    const assignee = params.get('assignee') || '（顧客名）';
    const car = params.get('car') || '（車種）';
    const number = params.get('number') || '（ナンバー）';
    const inDate = params.get('inDate') || getTodayString();
    const inTime = params.get('inTime') || '09:00';
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const d = new Date(inDate);
    const status = inDate && !Number.isNaN(d.getTime()) ? dayNames[d.getDay()] : 'unscheduled';
    const nowIso = new Date().toISOString();
    const attachments = [];
    const imageUrl = params.get('imageUrl') || params.get('attachmentUrl');
    if (imageUrl) {
      attachments.push({ type: 'image', name: 'calendar.jpg', data: imageUrl });
    }
    const imageUrls = params.get('imageUrls');
    if (imageUrls) {
      imageUrls.split(',').forEach((url, i) => {
        const u = url.trim();
        if (u) attachments.push({ type: 'image', name: `calendar_${i + 1}.jpg`, data: u });
      });
    }
    const newTask = {
      id: `t${Date.now()}`,
      status,
      color: 'bg-white',
      maker: '',
      car: (car || '').replace(/^（.*）$/, '$1'),
      number: (number || '').replace(/^（.*）$/, '$1'),
      assignee: (assignee || '').replace(/^（.*）$/, '$1'),
      inDate: inDate || '',
      inTime: inTime || '',
      outDate: '',
      loanerType: 'none',
      dots: ['white', 'white', 'white', 'white'],
      characters: [],
      tasks: [],
      statusEnteredAt: nowIso,
      statusHistory: [],
      attachments
    };
    setTasks(prev => [...prev, newTask]);
    setCurrentBoardId('planning');
    setCurrentView('board');
    setCalendarToast('入庫カードを作成しました');
    setTimeout(() => setCalendarToast(''), 4000);
  }, []);

  useEffect(() => {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(CALENDAR_PENDING_KEY) : null;
    if (raw) {
      try {
        sessionStorage.removeItem(CALENDAR_PENDING_KEY);
        const params = new URLSearchParams(raw);
        if (params.get('fromCalendar') === '1') createCardFromCalendarParams(params);
      } catch (_) {}
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('fromCalendar') === '1') {
      createCardFromCalendarParams(params);
      window.history.replaceState({}, '', window.location.pathname || '/');
    }
  }, [createCardFromCalendarParams]);

  const currentBoard = BOARDS[currentBoardId];

  const matchesSearch = (task) => {
    const a = (v) => (v || '').toString().toLowerCase();
    const ok = (field, filterVal) => !filterVal || a(field).includes(a(filterVal));
    return ok(task.assignee, searchFilters.assignee)
      && ok(task.maker, searchFilters.maker)
      && ok(task.car, searchFilters.car)
      && ok(task.receptionStaff, searchFilters.receptionStaff)
      && ok(task.bodyStaff, searchFilters.bodyStaff)
      && ok(task.paintStaff, searchFilters.paintStaff)
      && ok(task.number, searchFilters.number)
      && (!searchFilters.color || (task.color || 'bg-white') === searchFilters.color);
  };
  const filteredTasks = tasks.filter(matchesSearch);
  const CARD_COLOR_OPTIONS = ['bg-white', 'bg-yellow-300', 'bg-green-400', 'bg-cyan-300', 'bg-red-400', 'bg-purple-400', 'bg-blue-400', 'bg-gray-300'];
  const hasActiveFilters = Object.values(searchFilters).some(v => v && v.trim() !== '');

  // 納車ボード: 支払い済み列は表示しない。完了に置いたカードは看板に表示しない（データは残す）
  const boardColumns = currentBoardId === 'delivery'
    ? currentBoard.columns.filter(c => c.id !== 'delivered_paid')
    : currentBoard.columns;
  const hideColumnCards = (colId) => currentBoardId === 'delivery' && colId === 'completed';

  const getColumnStatuses = (col) => {
    if (!col || !col.id) return [];
    const custom = columnStatuses?.[currentBoardId]?.[col.id];
    const list = (Array.isArray(custom) && custom.length) ? custom : (Array.isArray(col.statuses) ? col.statuses : [col.id]);
    return Array.isArray(list) ? list : [col.id];
  };
  const getColumnPrimaryStatus = (col) => {
    if (!col || !col.id) return 'received';
    const list = getColumnStatuses(col);
    return (list && list[0]) ? list[0] : col.id;
  };

  const transitionTaskStatus = (task, newStatus, extra = {}) => {
    const nowIso = new Date().toISOString();
    const prevStatus = task.status;
    const prevEnteredAt = task.statusEnteredAt || nowIso;
    let history = Array.isArray(task.statusHistory) ? [...task.statusHistory] : [];
    if (prevStatus) {
      history = [...history, { status: prevStatus, enteredAt: prevEnteredAt, exitedAt: nowIso }];
    }
    return { ...task, ...extra, status: newStatus, statusEnteredAt: nowIso, statusHistory: history };
  };

  const handleDragStart = (e, id) => { setDraggedTaskId(id); e.dataTransfer.effectAllowed = 'move'; };
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDrop = (e, col) => {
    e.preventDefault();
    if (!draggedTaskId) return;
    const status = getColumnPrimaryStatus(col);
    let newInDate;
    if (currentBoardId === 'planning' && ['mon','tue','wed','thu','fri','sat','sun'].includes(col.id)) {
      const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      const targetDay = dayMap[col.id];
      const d = new Date();
      let diff = targetDay - d.getDay();
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
      newInDate = `${y}-${m}-${day}`;
    }
    setTasks(prev =>
      prev.map(t => {
        if (t.id !== draggedTaskId) return t;
        // ステータスが変わる場合のみ履歴を追加
        const base = status && status !== t.status
          ? transitionTaskStatus(t, status)
          : { ...t };
        return newInDate ? { ...base, inDate: newInDate } : base;
      })
    );
    setDraggedTaskId(null);
  };

  const handleCreateTask = (newTask) => {
    const firstColStatus = getColumnPrimaryStatus(currentBoard.columns[0]);
    const newId = `t${Date.now()}`;
    const nowIso = new Date().toISOString();
    const taskWithId = {
      ...newTask,
      id: newId,
      status: firstColStatus,
      statusEnteredAt: nowIso,
      statusHistory: [],
      attachments: Array.isArray(newTask.attachments) ? newTask.attachments : []
    };
    setTasks([...tasks, taskWithId]);
    if (newTask.loanerCarId && newTask.inDate) {
      setReservations(prev => [...prev, {
        id: `res${Date.now()}`,
        carId: newTask.loanerCarId,
        taskId: newId,
        taskName: `${newTask.assignee || '未設定'} ${newTask.car || '新規車両'}`,
        start: newTask.inDate,
        end: newTask.outDate || newTask.inDate,
        color: newTask.color || 'bg-blue-400'
      }]);
    }
    setIsCreateModalOpen(false);
    setCurrentView('board');
    // Googleスプレッドシートへ同期（VITE_SHEET_SYNC_URL が設定されている場合のみ）
    syncCardToSheet(taskWithId);
  };

  const handleReservationUpdate = (updatedRes) => {
    setReservations(prev => prev.map(r => r.id === updatedRes.id ? updatedRes : r));
    if (updatedRes.taskId) {
      setTasks(prev => prev.map(t => t.id === updatedRes.taskId ? { ...t, inDate: updatedRes.start, outDate: updatedRes.end, loanerCarId: updatedRes.carId } : t));
    }
  };

  const handleTaskUpdate = (updatedTask) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== updatedTask.id) return t;
      // ステータスが変わる場合は滞在時間を履歴に追加しつつ更新
      if (updatedTask.status && updatedTask.status !== t.status) {
        return transitionTaskStatus(t, updatedTask.status, updatedTask);
      }
      // ステータスが変わらない場合はその他の項目だけ上書きし、履歴系は保持
      return {
        ...t,
        ...updatedTask,
        statusEnteredAt: t.statusEnteredAt,
        statusHistory: t.statusHistory
      };
    }));
    if (updatedTask.loanerCarId && updatedTask.inDate) {
      setReservations(prev => prev.map(r => r.taskId === updatedTask.id ? { ...r, start: updatedTask.inDate, end: updatedTask.outDate || updatedTask.inDate, carId: updatedTask.loanerCarId, taskName: `${updatedTask.assignee || ''} ${updatedTask.car || ''}`.trim() || r.taskName } : r));
    }
  };

  const switchBoard = (boardId) => {
    setCurrentBoardId(boardId);
    setSelectedTaskId(null);
    setIsHeaderMenuOpen(false);
    setIsProjectMenuOpen(false);
    setCurrentView('board');
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans text-gray-800 overflow-hidden relative">
      {calendarToast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium shadow-lg animate-fade-in">
          {calendarToast}
        </div>
      )}
      <header className="bg-white border-b border-gray-200 flex items-center justify-between px-4 py-2 shadow-sm z-30">
        <div className="flex-1 min-w-0" aria-hidden />
        <div className="flex items-center gap-3 justify-center relative" ref={headerMenuRef}>
          <h1 className="text-lg font-bold text-gray-800">{APP_NAME}</h1>
          <button
            type="button"
            onClick={() => setIsHeaderMenuOpen(!isHeaderMenuOpen)}
            className={`text-sm font-medium rounded px-2 py-1.5 transition-colors flex items-center gap-1 ${isHeaderMenuOpen ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
            title="ボードを切り替え"
          >
            {currentView === 'board' ? currentBoard.title : '代車・レンタカー 貸出状況'}
            {currentView === 'board' && currentBoardId === 'main' && <ChevronDown className="w-4 h-4 flex-shrink-0" />}
          </button>
          <Button onClick={() => setIsCreateModalOpen(true)}>カード作成</Button>
          {isHeaderMenuOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-80 bg-white border border-gray-200 shadow-xl rounded-md py-2 z-50">
              <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">最近のボード</div>
              {BOARD_ORDER.map(id => BOARDS[id]).map(board => (
                <button key={board.id} onClick={() => switchBoard(board.id)} className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${currentBoardId === board.id && currentView === 'board' ? 'border-l-2 border-blue-500 bg-blue-50 text-blue-700' : 'text-gray-700'}`}>
                  {board.title}
                </button>
              ))}
              <div className="border-t border-gray-100 mt-2 pt-2">
                <button className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-gray-100 font-medium">すべてのボードを表示</button>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 flex items-center justify-end gap-3 min-w-0">
          <Bell className="w-5 h-5 text-gray-500 hover:text-gray-700 cursor-pointer" />
          <div className="relative" ref={searchMenuRef}>
            <button onClick={() => setIsSearchMenuOpen(!isSearchMenuOpen)} className={`px-3 py-1.5 rounded flex items-center gap-1 ${isSearchMenuOpen ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100'} text-gray-700`} title="カード検索">
              <Search className="w-4 h-4" />
              検索
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
            </button>
            {isSearchMenuOpen && (
              <div className="absolute top-full right-0 mt-1 w-80 bg-white border border-gray-200 shadow-xl rounded-md p-4 z-50">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">カードで絞り込み</div>
                <div className="space-y-3 text-sm">
                  <div>
                    <label className="block text-gray-600 mb-1">顧客名</label>
                    <input type="text" placeholder="例: 杉村" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={searchFilters.assignee} onChange={(e) => setSearchFilters(f => ({ ...f, assignee: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">メーカー</label>
                    <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white" value={searchFilters.maker} onChange={(e) => setSearchFilters(f => ({ ...f, maker: e.target.value }))}>
                      <option value="">すべて</option>
                      {Object.keys(CAR_MODELS).map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">車種</label>
                    <input type="text" placeholder="例: ノート" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={searchFilters.car} onChange={(e) => setSearchFilters(f => ({ ...f, car: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">受付担当者</label>
                    <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white" value={searchFilters.receptionStaff} onChange={(e) => setSearchFilters(f => ({ ...f, receptionStaff: e.target.value }))}>
                      <option value="">すべて</option>
                      {[...new Set([currentUser, ...RECEPTION_STAFF_OPTIONS])].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">鈑金担当者</label>
                    <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white" value={searchFilters.bodyStaff} onChange={(e) => setSearchFilters(f => ({ ...f, bodyStaff: e.target.value }))}>
                      <option value="">すべて</option>
                      {BODY_STAFF_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">塗装担当者</label>
                    <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white" value={searchFilters.paintStaff} onChange={(e) => setSearchFilters(f => ({ ...f, paintStaff: e.target.value }))}>
                      <option value="">すべて</option>
                      {PAINT_STAFF_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">ナンバー（車番）</label>
                    <input type="text" placeholder="例: 501" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={searchFilters.number} onChange={(e) => setSearchFilters(f => ({ ...f, number: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">カードの色</label>
                    <div className="flex gap-1 flex-wrap">
                      <button type="button" onClick={() => setSearchFilters(f => ({ ...f, color: '' }))} className={`w-6 h-6 rounded border text-[10px] flex items-center justify-center ${!searchFilters.color ? 'ring-2 ring-offset-1 ring-blue-500 border-blue-500' : 'border-gray-300 bg-gray-50'}`} title="すべて">全</button>
                      {CARD_COLOR_OPTIONS.map(colorClass => (
                        <button type="button" key={colorClass} onClick={() => setSearchFilters(f => ({ ...f, color: colorClass }))} className={`w-6 h-6 rounded border ${colorClass} ${searchFilters.color === colorClass ? 'ring-2 ring-offset-1 ring-blue-500 border-transparent' : 'border-gray-300'}`} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-200 flex justify-end">
                  <button type="button" onClick={() => setSearchFilters({ assignee: '', maker: '', car: '', receptionStaff: '', bodyStaff: '', paintStaff: '', number: '', color: '' })} className="text-sm text-gray-600 hover:underline">クリア</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative z-0">
        <div className="w-12 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-6 z-10 shadow-sm flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-500 shadow-sm border-2 border-white cursor-pointer" title="プロジェクトアイコン"></div>
          <Layout onClick={() => setCurrentView('board')} className={`w-6 h-6 cursor-pointer transition-colors ${currentView === 'board' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`} title="カンバンボード" />
          <Car onClick={() => setCurrentView('gantt')} className={`w-6 h-6 cursor-pointer transition-colors ${currentView === 'gantt' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`} title="代車・レンタカー貸出表" />
          <button type="button" onClick={() => setIsCalendarLinkModalOpen(true)} className="p-0.5 text-gray-400 hover:text-gray-600 cursor-pointer" title="カレンダー用リンク（入庫→カード作成）">
            <Calendar className="w-5 h-5" />
          </button>
          <FileText className="w-5 h-5 text-gray-400 hover:text-gray-600 cursor-pointer" />
          <Settings onClick={() => setIsSettingsOpen(true)} className="w-5 h-5 text-gray-400 hover:text-gray-600 cursor-pointer mt-auto" title="設定" />
        </div>

        <div className="flex-1 flex overflow-hidden bg-white">
          {currentView === 'gantt' ? (
            <LoanerGanttChart fleetCars={fleetCars} setFleetCars={setFleetCars} reservations={reservations} setReservations={setReservations} onReservationUpdate={handleReservationUpdate} setTasks={setTasks} />
          ) : (
            <>
              <div className={`flex flex-col overflow-hidden transition-all duration-300 ${selectedTaskId ? 'w-[calc(100%-450px)] border-r border-gray-200' : 'w-full'}`}>
                <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 pt-4 bg-white">
                  <div className="flex gap-2 h-full w-full min-w-0">
                    {boardColumns.map(col => {
                      const columnStatuses = getColumnStatuses(col);
                      const columnTasks = hideColumnCards(col.id) ? [] : filteredTasks.filter(t => {
                        if (columnStatuses.includes(t.status)) return true;
                        if (currentBoardId === 'planning' && t.status !== 'received' && t.status !== 'unscheduled' && t.inDate && ['mon','tue','wed','thu','fri','sat','sun'].includes(col.id)) {
                          const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
                          return new Date(t.inDate).getDay() === dayMap[col.id];
                        }
                        return false;
                      });
                      return (
                        <div key={col.id} className={`min-w-0 flex-1 flex flex-col rounded-md border border-gray-200 flex-shrink ${currentBoardId === 'planning' ? 'bg-gray-400' : 'bg-gray-50'}`} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, col)}>
                          <div className={`p-3 font-semibold flex justify-between items-center text-sm border-b border-gray-200 rounded-t-md ${currentBoardId === 'planning' ? 'bg-white text-gray-800' : 'bg-gray-100 text-gray-700'}`}>
                            <div className="truncate pr-2" title={col.name}>{col.name}</div>
                            <div className={`text-xs px-1.5 py-0.5 rounded-full border ${currentBoardId === 'planning' ? 'bg-gray-100 text-gray-600 border-gray-300' : 'bg-white text-gray-500 border-gray-200'}`}>
                              {columnTasks.length}
                            </div>
                          </div>
                          <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px]">
                            {columnTasks.map(task => (
                              <div key={task.id} draggable onDragStart={(e) => handleDragStart(e, task.id)} onClick={() => setSelectedTaskId(task.id)} className={`bg-white rounded shadow-sm border p-2 cursor-pointer active:cursor-grabbing hover:bg-gray-50 relative overflow-hidden group ${task.color === 'bg-white' ? '' : task.color} ${selectedTaskId === task.id ? 'border-2 border-red-500 ring-1 ring-red-500 ring-opacity-50' : 'border-gray-200'}`}>
                                 {task.color !== 'bg-white' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-black opacity-10"></div>}
                                {(task.loanerType && task.loanerType !== 'none') && (
                                  <div className="flex justify-end items-start mb-1 text-[10px]">
                                    <div className="flex items-center bg-green-100 text-green-800 px-1 rounded" title={LOANER_OPTIONS.find(o=>o.id===task.loanerType)?.label}>
                                      <Truck className="w-3 h-3 mr-0.5"/> 代
                                    </div>
                                  </div>
                                )}
                                <div className="text-xs font-medium text-gray-800 mb-1 leading-tight">
                                  {task.car} {task.number}<br/>{task.assignee}<br/>
                                  <span className="text-gray-500 font-normal inline-block mt-0.5">{formatInOutDate(task.inDate, task.outDate)}</span>
                                </div>
                                <div className="flex gap-1 mb-1 text-gray-500">
                                  {task.characters?.map(cId => { const Icon = AVAILABLE_CHARACTERS.find(c => c.id === cId)?.icon; return Icon ? <Icon key={cId} className="w-3.5 h-3.5" /> : null; })}
                                  {task.tasks?.map(tId => { const Icon = AVAILABLE_TASKS.find(t => t.id === tId)?.icon; return Icon ? <Icon key={tId} className="w-3.5 h-3.5" /> : null; })}
                                </div>
                                <div className="mt-2 flex gap-1">
                                  {task.dots.map((dotColor, i) => (
                                    <div key={i} className={`w-2.5 h-2.5 rounded-full border border-gray-400 ${dotColor === 'red' ? 'bg-red-500' : dotColor === 'blue' ? 'bg-blue-500' : dotColor === 'yellow' ? 'bg-yellow-400' : dotColor === 'green' ? 'bg-green-500' : dotColor === 'purple' ? 'bg-purple-500' : 'bg-white'}`}></div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {selectedTaskId && (
                <div className="w-[450px] flex-shrink-0 bg-white flex flex-col h-full overflow-hidden shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.1)] z-20">
                  <TaskDetailPanel
                    task={tasks.find(t => t.id === selectedTaskId)}
                    fleetCars={fleetCars}
                    defaultReceptionStaff={currentUser}
                    onClose={() => setSelectedTaskId(null)}
                    onUpdate={handleTaskUpdate}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {isCreateModalOpen && <CreateTaskModal fleetCars={fleetCars} defaultReceptionStaff={currentUser} onClose={() => setIsCreateModalOpen(false)} onSubmit={handleCreateTask} />}
      {isCalendarLinkModalOpen && <CalendarLinkModal onClose={() => setIsCalendarLinkModalOpen(false)} />}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => { setIsSettingsOpen(false); setIsLinkSettingsOpen(false); setIsFleetSettingsOpen(false); }}
            aria-hidden
          />
          <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">
                {isLinkSettingsOpen ? 'ボード間リンク設定' : isFleetSettingsOpen ? '代車マスタ設定' : '設定'}
              </h2>
              <button
                type="button"
                onClick={() => { setIsSettingsOpen(false); setIsLinkSettingsOpen(false); setIsFleetSettingsOpen(false); }}
                className="p-1 rounded hover:bg-gray-100 text-gray-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {isLinkSettingsOpen ? (
                <LinkConfigPanel
                  columnStatuses={columnStatuses}
                  setColumnStatuses={setColumnStatuses}
                  onBack={() => setIsLinkSettingsOpen(false)}
                />
              ) : isFleetSettingsOpen ? (
                <FleetMasterPanel
                  fleetCars={fleetCars}
                  setFleetCars={setFleetCars}
                  reservations={reservations}
                  setReservations={setReservations}
                  setTasks={setTasks}
                  onBack={() => setIsFleetSettingsOpen(false)}
                />
              ) : (
                <>
                  <div className="space-y-4">
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">ボード間リンク</h3>
                      <p className="text-sm text-gray-500 mb-3">全作業・鈑金・塗装・納車の列どうしの対応を確認・設定できます。</p>
                      <button type="button" onClick={() => setIsLinkSettingsOpen(true)} className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium text-sm flex items-center justify-center gap-2">
                        <Settings className="w-4 h-4" />
                        リンクを設定
                      </button>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">代車マスタ設定</h3>
                      <p className="text-sm text-gray-500 mb-3">代車・レンタカーの車両一覧を管理します。ガントチャートの車両リストにも反映されます。</p>
                      <button
                        type="button"
                        onClick={() => setIsFleetSettingsOpen(true)}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium text-sm flex items-center justify-center gap-2"
                      >
                        <Truck className="w-4 h-4" />
                        代車マスタを開く
                      </button>
                    </section>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- カード作成モーダルコンポーネント ---
function CreateTaskModal({ fleetCars = FLEET_CARS, defaultReceptionStaff = 'ログインユーザー', onClose, onSubmit }) {
  const [formData, setFormData] = useState({
    maker: '', car: '', number: '', assignee: '',
    inDate: getTodayString(), outDate: '',
    loanerType: 'none',
    loanerCarId: '',
    receptionStaff: defaultReceptionStaff,
    bodyStaff: '',
    paintStaff: '',
    color: 'bg-white', dots: ['white', 'white', 'white', 'white'],
    characters: [], tasks: [], description: ''
  });
  const [activeDotIndex, setActiveDotIndex] = useState(0);
  const [attachments, setAttachments] = useState([]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      car: formData.car || '新規車両',
      number: formData.number || '000',
      assignee: formData.assignee || '未設定',
      attachments: attachments
    });
  };

  const handleFileChange = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const next = [...attachments];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const type = isImageType(file.type) ? 'image' : 'pdf';
      const data = type === 'image' ? await readFileAsDataUrl(file) : await readFileAsDataUrl(file);
      next.push({ type, name: file.name, data });
    }
    setAttachments(next);
    e.target.value = '';
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-800">カードの作成</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          <form id="create-task-form" onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">表示アイコン</label>
                <div className="flex-1 flex gap-2 text-gray-500 flex-wrap">
                  {AVAILABLE_CHARACTERS.map(char => {
                    const Icon = char.icon;
                    return (
                      <button type="button" key={char.id} onClick={() => setFormData(p => ({...p, characters: p.characters.includes(char.id) ? p.characters.filter(c=>c!==char.id) : [...p.characters, char.id]}))} className={`p-1 rounded ${formData.characters.includes(char.id) ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}>
                        <Icon className="w-5 h-5" />
                      </button>
                    );
                  })}
                  <div className="w-px h-6 bg-gray-300 mx-1"></div>
                  {AVAILABLE_TASKS.map(task => {
                    const Icon = task.icon;
                    return (
                      <button type="button" key={task.id} onClick={() => setFormData(p => ({...p, tasks: p.tasks.includes(task.id) ? p.tasks.filter(t=>t!==task.id) : [...p.tasks, task.id]}))} className={`p-1 rounded ${formData.tasks.includes(task.id) ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}>
                        <Icon className="w-5 h-5" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <hr className="border-gray-200" />

            <div className="space-y-4">
              <div className="flex gap-4 items-center">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">入庫日 <span className="text-red-500">*</span></label>
                <input type="date" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40" value={formData.inDate} onChange={(e) => setFormData({...formData, inDate: e.target.value})} required />
                <label className="text-sm font-medium text-gray-700 ml-4">納車日</label>
                <input type="date" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40" value={formData.outDate} onChange={(e) => setFormData({...formData, outDate: e.target.value})} />
              </div>

              <div className="flex gap-4 items-center mt-2">
                <label className="w-32 text-right text-sm font-medium text-gray-700">代車・レンタカー</label>
                <div className="flex-1 flex flex-col gap-2">
                  <select
                    className="w-full max-w-[200px] border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                    value={formData.loanerType}
                    onChange={(e) => setFormData({...formData, loanerType: e.target.value, loanerCarId: e.target.value === 'none' ? '' : formData.loanerCarId})}
                  >
                    {LOANER_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                  </select>
                  {formData.loanerType !== 'none' && (
                    <select
                      className="w-full max-w-[280px] border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                      value={formData.loanerCarId}
                      onChange={(e) => setFormData({...formData, loanerCarId: e.target.value})}
                      title="ガントチャートの車両一覧から選択"
                    >
                      <option value="">車両を選択してください</option>
                      {FLEET_TYPE_OPTIONS.map(type => {
                        const carsInType = fleetCars.filter(f =>
                          f.type === type &&
                          (isFleetCarAvailableForToday(f) || f.id === formData.loanerCarId)
                        );
                        if (carsInType.length === 0) return null;
                        return (
                          <optgroup key={type} label={type}>
                            {carsInType.map(fleet => (
                              <option key={fleet.id} value={fleet.id}>{fleet.name}</option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  )}
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">メーカー <span className="text-red-500">*</span></label>
                <select className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm bg-white" value={formData.maker} onChange={(e) => setFormData({...formData, maker: e.target.value, car: ''})} required>
                  <option value="" disabled>選択してください</option>
                  {Object.keys(CAR_MODELS).map(maker => <option key={maker} value={maker}>{maker}</option>)}
                </select>
              </div>

              <div className="flex gap-4 items-start">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">モデル <span className="text-red-500">*</span></label>
                <select className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm bg-white disabled:bg-gray-100" value={formData.car} onChange={(e) => setFormData({...formData, car: e.target.value})} disabled={!formData.maker} required>
                  <option value="" disabled>{formData.maker ? '選択してください' : 'メーカーを先に選択'}</option>
                  {formData.maker && CAR_MODELS[formData.maker].map(model => <option key={model} value={model}>{model}</option>)}
                </select>
              </div>

              <div className="flex gap-4 items-center">
                 <label className="w-32 text-right text-sm font-medium text-gray-700">車番</label>
                 <input type="text" className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="例: 1234" value={formData.number} onChange={e => setFormData({...formData, number: e.target.value})} />
              </div>
              <div className="flex gap-4 items-center">
                 <label className="w-32 text-right text-sm font-medium text-gray-700">顧客名</label>
                 <input type="text" className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="例: 山田太郎" value={formData.assignee} onChange={e => setFormData({...formData, assignee: e.target.value})} />
              </div>

              <div className="flex gap-4 items-center">
                <label className="w-32 text-right text-sm font-medium text-gray-700">受付担当者</label>
                <div className="flex-1">
                  <select
                    className="w-full max-w-[200px] border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                    value={formData.receptionStaff}
                    onChange={(e) => setFormData({...formData, receptionStaff: e.target.value})}
                    title="ログインアカウントが初期値。必要に応じて変更可能"
                  >
                    {[...new Set([defaultReceptionStaff, ...RECEPTION_STAFF_OPTIONS])].map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-4 items-center">
                <label className="w-32 text-right text-sm font-medium text-gray-700">板金担当者</label>
                <div className="flex-1">
                  <select
                    className="w-full max-w-[200px] border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                    value={formData.bodyStaff}
                    onChange={(e) => setFormData({...formData, bodyStaff: e.target.value})}
                  >
                    <option value="">選択してください</option>
                    {BODY_STAFF_OPTIONS.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-4 items-center">
                <label className="w-32 text-right text-sm font-medium text-gray-700">塗装担当者</label>
                <div className="flex-1">
                  <select
                    className="w-full max-w-[200px] border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                    value={formData.paintStaff}
                    onChange={(e) => setFormData({...formData, paintStaff: e.target.value})}
                  >
                    <option value="">選択してください</option>
                    {PAINT_STAFF_OPTIONS.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">ドット</label>
                <div>
                  <div className="flex gap-3 mb-2">
                    {formData.dots.map((dotColor, index) => (
                      <button type="button" key={index} onClick={() => setActiveDotIndex(index)} className={`w-6 h-6 rounded-full border-2 ${activeDotIndex === index ? 'ring-2 ring-offset-1 ring-blue-500' : ''} ${dotColor === 'red' ? 'border-red-500 bg-red-100' : dotColor === 'yellow' ? 'border-yellow-400 bg-yellow-100' : dotColor === 'blue' ? 'border-blue-500 bg-blue-100' : dotColor === 'green' ? 'border-green-500 bg-green-100' : dotColor === 'purple' ? 'border-purple-500 bg-purple-100' : 'border-gray-400 bg-white'}`}></button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {['red', 'yellow', 'blue', 'green', 'white', 'purple'].map(color => (
                      <button type="button" key={color} onClick={() => {const newDots = [...formData.dots]; newDots[activeDotIndex] = color; setFormData({...formData, dots: newDots});}} className={`w-5 h-5 rounded border border-gray-300 hover:scale-110 transition-transform ${color === 'red' ? 'bg-red-500' : color === 'yellow' ? 'bg-yellow-400' : color === 'blue' ? 'bg-blue-500' : color === 'green' ? 'bg-green-500' : color === 'purple' ? 'bg-purple-500' : 'bg-white'}`}></button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-4 items-center">
                <label className="w-32 text-right text-sm font-medium text-gray-700">カードの色</label>
                <div className="flex gap-1 flex-wrap flex-1">
                  {['bg-white', 'bg-yellow-300', 'bg-green-400', 'bg-cyan-300', 'bg-red-400', 'bg-purple-400', 'bg-blue-400', 'bg-gray-300'].map(colorClass => (
                    <button type="button" key={colorClass} onClick={() => setFormData({...formData, color: colorClass})} className={`w-6 h-6 rounded border ${colorClass} ${formData.color === colorClass ? 'ring-2 ring-offset-1 ring-blue-500 border-transparent' : 'border-gray-300'}`}></button>
                  ))}
                </div>
              </div>

              {/* 説明 */}
              <div className="flex gap-4 items-start mt-4">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">説明</label>
                <div className="flex-1">
                  <textarea
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none min-h-[100px] resize-y"
                    placeholder="カードの説明や特記事項を入力してください..."
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                  ></textarea>
                </div>
              </div>

              {/* 添付ファイル（PDF・画像） */}
              <div className="flex gap-4 items-start">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">添付ファイル</label>
                <div className="flex-1 space-y-3">
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-3">
                      {attachments.map((att, idx) => (
                        <div key={idx} className="relative border border-gray-200 rounded-lg overflow-hidden bg-gray-50 group/att">
                          {att.type === 'image' ? (
                            <img
                              src={att.data}
                              alt={att.name}
                              className="w-full max-w-[120px] sm:max-w-[160px] max-h-20 sm:max-h-28 h-auto object-contain block"
                            />
                          ) : (
                            <div className="w-[140px] h-[80px] flex items-center justify-center bg-gray-100">
                              <FileText className="w-8 h-8 text-gray-500" />
                            </div>
                          )}
                          <div className="px-2 py-1 text-xs text-gray-600 truncate max-w-[140px]" title={att.name}>{att.name}</div>
                          <button type="button" onClick={() => removeAttachment(idx)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover/att:opacity-100 hover:opacity-100 transition-opacity">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="relative border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer group">
                    <Paperclip className="w-8 h-8 text-gray-400 mb-2 group-hover:text-blue-500 transition-colors" />
                    <div className="text-center">
                      <span className="text-sm text-gray-600">クリックまたはドラッグ＆ドロップでPDF・画像を添付</span>
                      <div className="text-xs text-gray-400 mt-1">対応: PDF / JPEG, PNG, WebP, GIF</div>
                    </div>
                    <input
                      type="file"
                      accept=".pdf,image/jpeg,image/png,image/webp,image/gif"
                      multiple
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      title="PDFまたは画像を選択"
                    />
                  </div>
                </div>
              </div>

            </div>
          </form>
        </div>

        <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex justify-end gap-4 rounded-b-lg">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:underline">キャンセル</button>
          <Button type="submit" form="create-task-form">カード作成</Button>
        </div>
      </div>
    </div>
  );
}

// --- タスク詳細パネルコンポーネント ---
function Accordion({ title, children, defaultOpen = true }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-200 py-3">
      <button className="flex items-center gap-2 w-full text-left font-semibold text-gray-800 text-sm hover:bg-gray-50 p-1 rounded" onClick={() => setIsOpen(!isOpen)}>
        <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        {title}
      </button>
      {isOpen && <div className="mt-3 pl-6 pr-2">{children}</div>}
    </div>
  );
}

function TaskDetailPanel({ task, fleetCars = [], defaultReceptionStaff = 'ログインユーザー', onClose, onUpdate }) {
  const [activeDotIndex, setActiveDotIndex] = useState(0);
  if (!task) return null;
  const issueKey = `#${task.id.replace(/\D/g, '') || Math.floor(Math.random()*1000) + 2000}`;
  const dots = task.dots || ['white', 'white', 'white', 'white'];
  const receptionOptions = [...new Set([defaultReceptionStaff, ...RECEPTION_STAFF_OPTIONS])];
  const loanerFleetCar = task.loanerCarId ? fleetCars.find(f => f.id === task.loanerCarId) : null;

  const handleDotColor = (color) => {
    const newDots = [...dots];
    newDots[activeDotIndex] = color;
    onUpdate({ ...task, dots: newDots });
  };

  const handleFileChange = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const list = Array.isArray(task.attachments) ? [...task.attachments] : [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const type = isImageType(file.type) ? 'image' : 'pdf';
      const data = await readFileAsDataUrl(file);
      list.push({ type, name: file.name, data });
    }
    onUpdate({ ...task, attachments: list });
    e.target.value = '';
  };

  const removeAttachment = (index) => {
    const list = (task.attachments || []).filter((_, i) => i !== index);
    onUpdate({ ...task, attachments: list });
  };

  const attachmentsList = Array.isArray(task.attachments) ? task.attachments : [];

  return (
    <div className="flex h-full text-gray-800 bg-white">
      <div className="flex-1 flex flex-col h-full overflow-hidden border-l border-gray-200 shadow-xl">
        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-10">
          <div className="flex items-center text-sm text-gray-500 gap-1 overflow-hidden">
             <div className="w-5 h-5 bg-gradient-to-tr from-cyan-400 to-blue-500 rounded flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold">A</div>
             <a href="#" className="hover:underline truncate ml-1">株式会社 清田自動車</a>
             <span>/</span><a href="#" className="hover:underline text-blue-600 font-medium">{issueKey}</a>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:bg-gray-100 p-1.5 rounded"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="mb-4 flex items-start gap-2">
             <div className="text-xl font-bold flex-1">- {(task.assignee || '').split(' ')[0]} {task.car}{task.number}</div>
          </div>

          <div className="py-3 pl-6 pr-2 space-y-3 text-sm border-b border-gray-200">
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">代車・レンタカー:</span>
               <select
                 value={task.loanerType || 'none'}
                 onChange={(e) => onUpdate({ ...task, loanerType: e.target.value })}
                 className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[200px] transition-colors bg-gray-50"
               >
                 {LOANER_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
               </select>
            </div>
            {task.loanerType && task.loanerType !== 'none' && (
              <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                <span className="text-gray-500">代車（貸出車両）:</span>
                <select
                  value={task.loanerCarId || ''}
                  onChange={(e) => onUpdate({ ...task, loanerCarId: e.target.value })}
                  className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[280px] transition-colors bg-gray-50"
                >
                  <option value="">車両を選択してください</option>
                  {FLEET_TYPE_OPTIONS.map(type => {
                    const carsInType = fleetCars.filter(f =>
                      f.type === type &&
                      (isFleetCarAvailableForToday(f) || f.id === task.loanerCarId)
                    );
                    if (carsInType.length === 0) return null;
                    return (
                      <optgroup key={type} label={type}>
                        {carsInType.map(fleet => (
                          <option key={fleet.id} value={fleet.id}>{fleet.name}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>
            )}
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">車種:</span>
               <input type="text" value={task.car || ''} onChange={(e) => onUpdate({ ...task, car: e.target.value })} className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[250px]" />
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">車番:</span>
               <input type="text" value={task.number || ''} onChange={(e) => onUpdate({ ...task, number: e.target.value })} className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[250px]" />
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">顧客:</span>
               <input type="text" value={task.assignee || ''} onChange={(e) => onUpdate({ ...task, assignee: e.target.value })} className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[250px]" />
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">受付担当者:</span>
               <select
                 value={task.receptionStaff || ''}
                 onChange={(e) => onUpdate({ ...task, receptionStaff: e.target.value })}
                 className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[200px] transition-colors bg-gray-50"
               >
                 {receptionOptions.map(name => <option key={name} value={name}>{name}</option>)}
               </select>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">板金担当者:</span>
               <select
                 value={task.bodyStaff || ''}
                 onChange={(e) => onUpdate({ ...task, bodyStaff: e.target.value })}
                 className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[200px] transition-colors bg-gray-50"
               >
                 <option value="">選択してください</option>
                 {BODY_STAFF_OPTIONS.map(name => <option key={name} value={name}>{name}</option>)}
               </select>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">塗装担当者:</span>
               <select
                 value={task.paintStaff || ''}
                 onChange={(e) => onUpdate({ ...task, paintStaff: e.target.value })}
                 className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[200px] transition-colors bg-gray-50"
               >
                 <option value="">選択してください</option>
                 {PAINT_STAFF_OPTIONS.map(name => <option key={name} value={name}>{name}</option>)}
               </select>
            </div>
          </div>

          <Accordion title="日付" defaultOpen={true}>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                 <span className="text-gray-500">入庫日:</span>
                 <input type="date" value={task.inDate || ''} onChange={(e) => onUpdate({ ...task, inDate: e.target.value })} className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[150px]" />
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                 <span className="text-gray-500">納車日:</span>
                 <input type="date" value={task.outDate || ''} onChange={(e) => onUpdate({ ...task, outDate: e.target.value })} className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[150px]" />
              </div>
            </div>
          </Accordion>

          <Accordion title="ドット" defaultOpen={true}>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3 mb-2">
                {dots.map((dotColor, index) => (
                  <button
                    type="button"
                    key={index}
                    onClick={() => setActiveDotIndex(index)}
                    className={`w-6 h-6 rounded-full border-2 flex-shrink-0 ${activeDotIndex === index ? 'ring-2 ring-offset-1 ring-blue-500' : ''} ${dotColor === 'red' ? 'border-red-500 bg-red-100' : dotColor === 'yellow' ? 'border-yellow-400 bg-yellow-100' : dotColor === 'blue' ? 'border-blue-500 bg-blue-100' : dotColor === 'green' ? 'border-green-500 bg-green-100' : dotColor === 'purple' ? 'border-purple-500 bg-purple-100' : 'border-gray-400 bg-white'}`}
                  />
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                {['red', 'yellow', 'blue', 'green', 'white', 'purple'].map(color => (
                  <button
                    type="button"
                    key={color}
                    onClick={() => handleDotColor(color)}
                    className={`w-5 h-5 rounded border border-gray-300 hover:scale-110 transition-transform ${color === 'red' ? 'bg-red-500' : color === 'yellow' ? 'bg-yellow-400' : color === 'blue' ? 'bg-blue-500' : color === 'green' ? 'bg-green-500' : color === 'purple' ? 'bg-purple-500' : 'bg-white'}`}
                  />
                ))}
              </div>
            </div>
          </Accordion>

          <Accordion title="カードの色" defaultOpen={true}>
            <div className="flex gap-1 flex-wrap">
              {['bg-white', 'bg-yellow-300', 'bg-green-400', 'bg-cyan-300', 'bg-red-400', 'bg-purple-400', 'bg-blue-400', 'bg-gray-300'].map(colorClass => (
                <button
                  type="button"
                  key={colorClass}
                  onClick={() => onUpdate({ ...task, color: colorClass })}
                  className={`w-6 h-6 rounded border ${colorClass} ${(task.color || 'bg-white') === colorClass ? 'ring-2 ring-offset-1 ring-blue-500 border-transparent' : 'border-gray-300'}`}
                />
              ))}
            </div>
          </Accordion>

          <Accordion title="説明" defaultOpen={true}>
            <textarea
              className="w-full text-sm text-gray-700 p-2 border border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none rounded resize-y min-h-[80px]"
              value={task.description !== undefined ? task.description : ''}
              onChange={(e) => onUpdate({ ...task, description: e.target.value })}
              placeholder="カードの説明や特記事項を入力してください..."
            />
          </Accordion>

          <Accordion title="添付ファイル" defaultOpen={true}>
            <div className="space-y-3">
              {attachmentsList.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {attachmentsList.map((att, idx) => (
                    <div key={idx} className="relative border border-gray-200 rounded-lg overflow-hidden bg-gray-50 group/att">
                      {att.type === 'image' ? (
                        <img
                          src={att.data}
                          alt={att.name}
                          className="max-w-full max-h-24 sm:max-h-32 w-auto h-auto object-contain block rounded-t"
                          style={{ maxWidth: 'min(180px, 100%)' }}
                        />
                      ) : (
                        <a href={att.data} target="_blank" rel="noopener noreferrer" className="w-[140px] h-[80px] flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-t block">
                          <FileText className="w-8 h-8 text-gray-500" />
                        </a>
                      )}
                      <div className="px-2 py-1 text-xs text-gray-600 truncate max-w-[180px]" title={att.name}>{att.name}</div>
                      <button type="button" onClick={() => removeAttachment(idx)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover/att:opacity-100 hover:opacity-100 transition-opacity">×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="relative border-2 border-dashed border-gray-300 rounded-lg p-4 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer group">
                <Paperclip className="w-6 h-6 text-gray-400 mb-2 group-hover:text-blue-500 transition-colors" />
                <div className="text-center">
                  <span className="text-sm text-gray-600">クリックでPDF・画像を追加</span>
                  <div className="text-xs text-gray-400 mt-1">対応: PDF / JPEG, PNG, WebP, GIF</div>
                </div>
                <input
                  type="file"
                  accept=".pdf,image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  title="PDFまたは画像を選択"
                />
              </div>
            </div>
          </Accordion>
        </div>
      </div>
    </div>
  );
}

// --- メインエントリーポイント ---
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  useEffect(() => {
    const q = window.location.search;
    if (q && q.includes('fromCalendar=1')) {
      try { sessionStorage.setItem(CALENDAR_PENDING_KEY, q); } catch (_) {}
      window.history.replaceState({}, '', window.location.pathname || '/');
    }
  }, []);
  if (!isLoggedIn) return <LoginScreen onLogin={() => { setIsLoggedIn(true); setCurrentUser('ログインユーザー'); }} />;
  return <KanbanApp currentUser={currentUser} />;
}
