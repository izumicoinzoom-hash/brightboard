/**
 * Firebase Authentication / Firestore の初期化とヘルパー
 * .env に VITE_FIREBASE_* を設定してください。
 */
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let app = null;
let auth = null;
let db = null;

export function isFirebaseConfigured() {
  return !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);
}

/**
 * スマホ・タブレット判定。
 * - 認証: PC のみ Google ログイン必須・スマホ/タブレットはログイン免除（App.jsx で使用）。
 * - ログイン方式: スマホ・タブレットではポップアップが不安定なため signInWithRedirect を使う。
 */
export function isMobileOrNarrow() {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
  const ua = navigator.userAgent;
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  if (typeof window !== 'undefined' && window.innerWidth < 768) return true;
  return false;
}

export function getFirebaseAuth() {
  if (!isFirebaseConfigured()) return null;
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    // Chrome（特にスマホ）でのセッション保持を安定させるため localStorage 永続化に変更
    setPersistence(auth, browserLocalPersistence).catch(() => {
      // 失敗した場合はデフォルト(session)のまま継続
    });
    db = getFirestore(app);
  }
  return auth;
}

export function getFirestoreDb() {
  if (!isFirebaseConfigured()) return null;
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    if (auth) {
      setPersistence(auth, browserLocalPersistence).catch(() => {});
    }
    db = getFirestore(app);
  }
  return db;
}

/** リダイレクトから戻った後の結果を処理（アプリ起動時に1回呼ぶ） */
export async function handleRedirectResult() {
  const a = getFirebaseAuth();
  if (!a) return null;
  try {
    const result = await getRedirectResult(a);
    return result ? result.user : null;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('getRedirectResult error:', err);
    return null;
  }
}

export async function signInWithGoogle() {
  const a = getFirebaseAuth();
  if (!a) throw new Error('Firebaseの設定がありません。');
  const provider = new GoogleAuthProvider();
  if (isMobileOrNarrow()) {
    await signInWithRedirect(a, provider);
    return null;
  }
  const result = await signInWithPopup(a, provider);
  return result.user;
}

export async function signOut() {
  const a = getFirebaseAuth();
  if (a) await firebaseSignOut(a);
}

// --- Firestore: タスク・予約向けの汎用ヘルパー ---

export function subscribeCollection(path, onChange) {
  const database = getFirestoreDb();
  if (!database) return () => {};
  const colRef = collection(database, path);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const items = snapshot.docs
        .map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        // ソフト削除フラグが立っているドキュメントは UI から除外。
        // 全 collection 共通フィルタなので、別用途で deleted フィールドを
        // 使う場合は別名（archived 等）を採用すること。
        .filter(item => item.deleted !== true);
      onChange(items);
    },
    (error) => {
      // パーミッションエラーなどで snapshot listener が失敗しても、
      // アプリ全体がクラッシュしないようにする（ログだけ残す）
      if (typeof console !== 'undefined') {
        console.warn('Firestore subscribeCollection error for path:', path, error);
      }
    }
  );
}

// --- 多層防御: NFCモード中の書き込み封印 + 一括移動トリップワイヤ ---
// 設計意図:
//   Layer A: window.__bbWasNfcUrl はページ初期ロード時に立てるスティッキーフラグ。
//            isNfcStandalone が一瞬転倒（hash 剥がれ等）してもフラグは戻らないので、
//            その隙に走る KanbanApp 由来の書き込みを物理的にブロックできる。
//            NFC ページ自身の正規書き込みは { allowDuringNfc: true } で opt-in。
//   Layer B: 1tick (1秒) で 3 件以上の書き込みは「一括事故」とみなして強制停止。
//            redistributeUnscheduledByInDate 等の正規一括処理は { allowBulk: true } で opt-in。
const WRITE_HISTORY_WINDOW_MS = 1000;
const WRITE_BULK_THRESHOLD = 3;
const writeHistory = [];
let bulkAlertSent = false;

function notifyBbSafetyAlert(reason, detail) {
  // Firestore には書かない（Layer A 発動中は notifications も封印される / 無限ループ回避）
  if (typeof console !== 'undefined') {
    console.error('[BB-SAFETY]', reason, detail);
  }
  try {
    const botUrl = import.meta.env.VITE_SECRETARY_BOT_URL;
    const botSecret = import.meta.env.VITE_SECRETARY_BOT_INCIDENT_SECRET;
    if (!botUrl || !botSecret || typeof fetch === 'undefined') return;
    fetch(`${botUrl.replace(/\/$/, '')}/incident/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Incident-Secret': botSecret },
      body: JSON.stringify({
        notificationId: `bb-safety-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fromUser: 'BB-SAFETY-GUARD',
        fromEmail: '',
        message: `[BB-SAFETY] ${reason}`,
        cardSnapshot: { detail, url: typeof window !== 'undefined' ? window.location.href : '' },
        createdAt: new Date().toISOString(),
      }),
    }).catch(() => {});
  } catch (_) {
    // noop: 通知失敗してもガード自体は機能させる
  }
}

function checkBulkTripwire(path, id, options) {
  if (options && options.allowBulk) return true;
  const now = Date.now();
  while (writeHistory.length > 0 && now - writeHistory[0].at > WRITE_HISTORY_WINDOW_MS) {
    writeHistory.shift();
  }
  writeHistory.push({ at: now, path, id });
  if (writeHistory.length >= WRITE_BULK_THRESHOLD) {
    if (!bulkAlertSent) {
      bulkAlertSent = true;
      setTimeout(() => { bulkAlertSent = false; }, 5000);
      notifyBbSafetyAlert('bulk_write_blocked', {
        windowMs: WRITE_HISTORY_WINDOW_MS,
        threshold: WRITE_BULK_THRESHOLD,
        recent: writeHistory.slice(),
      });
    }
    return false;
  }
  return true;
}

function checkNfcGuard(path, id, options) {
  if (typeof window === 'undefined') return true;
  if (!window.__bbWasNfcUrl) return true;
  if (options && options.allowDuringNfc) return true;
  notifyBbSafetyAlert('write_blocked_during_nfc', { path, id });
  return false;
}

// --- 監査ログ: tasks / reservations の全 write を append-only で記録 ---
// 目的:
//   どの端末・誰が・いつ・どのフィールドを変更したかを後追いできるようにする。
//   写真・カラーナンバー・車番など、statusHistory に乗らないフィールドの消失原因を
//   特定するための一次情報源。boards/main/auditLogs/{autoId} に永続化。
// 設計:
//   - actor は App.jsx から setCurrentActor() で渡される currentUser/Email
//   - deviceLabel は localStorage('bb_device_label') を任意で（端末識別用、未設定可）
//   - before/after は丸ごと保存（Firestore は安いので diff 計算は後段で行う）
//   - 失敗してもメイン書き込みは止めない（fire-and-forget）
const AUDITED_PATHS = new Set(['boards/main/tasks', 'boards/main/reservations']);
const AUDIT_PATH = 'boards/main/auditLogs';
const currentActor = { name: null, email: null };

export function setCurrentActor(name, email) {
  currentActor.name = name || null;
  currentActor.email = email || null;
}

function readDeviceLabel() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem('bb_device_label') || null;
  } catch (_) {
    return null;
  }
}

async function fetchBeforeSnapshot(path, id) {
  if (!AUDITED_PATHS.has(path)) return null;
  try {
    const database = getFirestoreDb();
    if (!database) return null;
    const ref = doc(database, path, id);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (_) {
    return null;
  }
}

async function writeAuditLog(path, id, action, before, after, options) {
  if (!AUDITED_PATHS.has(path)) return;
  try {
    const database = getFirestoreDb();
    if (!database) return;
    const colRef = collection(database, AUDIT_PATH);
    await addDoc(colRef, {
      path,
      docId: id,
      action,
      actor: currentActor.name,
      actorEmail: currentActor.email,
      deviceLabel: readDeviceLabel(),
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      url: typeof window !== 'undefined' ? window.location.href : null,
      reason: options && options.reason ? options.reason : null,
      before: before || null,
      after: after || null,
      ts: serverTimestamp(),
    });
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[auditLog] write failed:', e);
    }
  }
}

export async function upsertDocument(path, id, data, options) {
  if (!checkNfcGuard(path, id, options)) return;
  if (!checkBulkTripwire(path, id, options)) return;
  const database = getFirestoreDb();
  if (!database) return;
  const ref = doc(database, path, id);
  const before = await fetchBeforeSnapshot(path, id);
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  writeAuditLog(path, id, 'upsert', before, data, options);
}

// --- 代車データ破壊ガード: boards/main/tasks 専用 ---
// 既存 loanerType / loanerCarId / statusHistory を破壊的に上書きする書き込みを弾く。
// reservations 補完 useEffect 等の不完全な stub による事故再発を防ぐ最後の砦。
// 緊急回避が必要な場合は { allowLoanerOverride: true } を渡す（手動キャンセル等）。
const LOANER_TYPE_NON_NONE = ['loaner_k', 'loaner_n', 'rental', 'other_rental'];

function detectLoanerInvariantViolations(prev, next) {
  const violations = [];
  if (!prev) return violations;
  if (
    LOANER_TYPE_NON_NONE.includes(prev.loanerType) &&
    Object.prototype.hasOwnProperty.call(next, 'loanerType') &&
    next.loanerType === 'none'
  ) {
    violations.push({ field: 'loanerType', from: prev.loanerType, to: next.loanerType });
  }
  if (
    typeof prev.loanerCarId === 'string' && prev.loanerCarId.length > 0 &&
    Object.prototype.hasOwnProperty.call(next, 'loanerCarId') &&
    (next.loanerCarId === '' || next.loanerCarId === null || next.loanerCarId === undefined)
  ) {
    violations.push({ field: 'loanerCarId', from: prev.loanerCarId, to: next.loanerCarId });
  }
  const prevHist = Array.isArray(prev.statusHistory) ? prev.statusHistory : [];
  if (Object.prototype.hasOwnProperty.call(next, 'statusHistory')) {
    const nextHist = Array.isArray(next.statusHistory) ? next.statusHistory : [];
    if (prevHist.length > 0 && nextHist.length < prevHist.length) {
      violations.push({ field: 'statusHistory', from: prevHist.length, to: nextHist.length });
    }
  }
  return violations;
}

export async function safeUpsertTask(id, data, options) {
  const path = 'boards/main/tasks';
  if (!checkNfcGuard(path, id, options)) return { ok: false, reason: 'nfc_guard' };
  if (!checkBulkTripwire(path, id, options)) return { ok: false, reason: 'bulk_tripwire' };
  const database = getFirestoreDb();
  if (!database) return { ok: false, reason: 'no_db' };
  const ref = doc(database, path, id);
  let before = null;
  let beforeFetched = false;
  if (!options || !options.allowLoanerOverride) {
    try {
      const snap = await getDoc(ref);
      beforeFetched = true;
      if (snap.exists()) {
        before = snap.data();
        const violations = detectLoanerInvariantViolations(before, data);
        if (violations.length > 0) {
          notifyBbSafetyAlert('loaner_invariant_blocked', {
            id,
            reason: options && options.reason ? options.reason : 'unknown',
            violations,
          });
          return { ok: false, reason: 'loaner_invariant', violations };
        }
      }
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.warn('[safeUpsertTask] preflight read failed, falling back to upsert:', e);
      }
    }
  }
  if (!beforeFetched) {
    before = await fetchBeforeSnapshot(path, id);
  }
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  writeAuditLog(path, id, 'upsert', before, data, options);
  return { ok: true };
}

export async function deleteDocument(path, id, options) {
  if (!checkNfcGuard(path, id, options)) return;
  if (!checkBulkTripwire(path, id, options)) return;
  const database = getFirestoreDb();
  if (!database) return;
  const ref = doc(database, path, id);
  const before = await fetchBeforeSnapshot(path, id);
  await deleteDoc(ref);
  writeAuditLog(path, id, 'delete', before, null, options);
}

export { onAuthStateChanged };
