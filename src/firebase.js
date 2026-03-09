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
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
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
      const items = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
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

export async function upsertDocument(path, id, data) {
  const database = getFirestoreDb();
  if (!database) return;
  const ref = doc(database, path, id);
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function deleteDocument(path, id) {
  const database = getFirestoreDb();
  if (!database) return;
  const ref = doc(database, path, id);
  await deleteDoc(ref);
}

export { onAuthStateChanged };
