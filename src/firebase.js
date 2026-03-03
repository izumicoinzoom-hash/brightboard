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

export async function signInWithGoogle() {
  const a = getFirebaseAuth();
  if (!a) throw new Error('Firebaseの設定がありません。');
  const provider = new GoogleAuthProvider();
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
  return onSnapshot(colRef, (snapshot) => {
    const items = snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
    onChange(items);
  });
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
