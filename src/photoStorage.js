/**
 * BB鈑金版 写真撮影機能 - Storage/Firestore I/O ユーティリティ
 *
 * 「消えない」設計3原則（チケット 2026-04-30 追加）
 *   原則1: 写真は本体ドキュメントに埋め込まない（Storage + メタデータ参照のみ）
 *   原則2: エラーを握り潰さない（catch(()=>{}) 禁止・必ず throw + audit log）
 *   原則3: 楽観更新を1段切り離す（Storage 完了 → Firestore 書き込みの順序厳守）
 */

import { getApp } from 'firebase/app';
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable
} from 'firebase/storage';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp
} from 'firebase/firestore';
import { getFirestoreDb, getFirebaseAuth } from './firebase';

// ---------------------------------------------------------------------------
// Storage シングルトン
// ---------------------------------------------------------------------------
let _storage = null;
function getFireStorage() {
  if (!_storage) _storage = getStorage(getApp());
  return _storage;
}

// ---------------------------------------------------------------------------
// 内部ヘルパー
// ---------------------------------------------------------------------------

/**
 * パス文字として危険な `/` `\` を除去し、前後の空白をトリム。
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function sanitizePathSegment(value, fallback = '未設定') {
  if (value === undefined || value === null) return fallback;
  const s = String(value).replace(/[\\/]/g, '').trim();
  return s.length > 0 ? s : fallback;
}

/**
 * 数字文字列の下4桁を抽出（数字以外は無視）。短ければ全体を返す。
 * @param {unknown} value
 * @returns {string}
 */
function lastFourDigits(value) {
  if (value === undefined || value === null) return '0000';
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return sanitizePathSegment(value, '0000');
  return digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, '0');
}

/**
 * Date を YYYYMMDD 文字列に変換（ローカルタイム基準）
 * @param {Date} date
 * @returns {string}
 */
function formatYYYYMMDD(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('formatYYYYMMDD: invalid Date');
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** 拡張子から動画かを判定 */
function isVideoExt(ext) {
  const e = String(ext || '').toLowerCase();
  return e === 'mp4' || e === 'webm';
}

/**
 * 画像 Blob から自然サイズ取得。失敗時は null を返す（throw しない）。
 * @param {Blob} blob
 * @returns {Promise<{width: number|null, height: number|null}>}
 */
function readImageDimensions(blob) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof URL === 'undefined') {
      resolve({ width: null, height: null });
      return;
    }
    let url = null;
    try {
      url = URL.createObjectURL(blob);
    } catch (e) {
      resolve({ width: null, height: null });
      return;
    }
    const img = new Image();
    const cleanup = () => {
      try { URL.revokeObjectURL(url); } catch (_) { /* noop */ }
    };
    img.onload = () => {
      const w = img.naturalWidth || null;
      const h = img.naturalHeight || null;
      cleanup();
      resolve({ width: w, height: h });
    };
    img.onerror = () => {
      cleanup();
      resolve({ width: null, height: null });
    };
    img.src = url;
  });
}

/**
 * 動画 Blob から duration(秒) を取得。失敗時は null を返す（throw しない）。
 * @param {Blob} blob
 * @returns {Promise<number|null>}
 */
function readVideoDuration(blob) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      resolve(null);
      return;
    }
    let url = null;
    try {
      url = URL.createObjectURL(blob);
    } catch (e) {
      resolve(null);
      return;
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    const cleanup = () => {
      try { URL.revokeObjectURL(url); } catch (_) { /* noop */ }
    };
    video.onloadedmetadata = () => {
      const d = (typeof video.duration === 'number' && Number.isFinite(video.duration))
        ? video.duration
        : null;
      cleanup();
      resolve(d);
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
    video.src = url;
  });
}

/**
 * 監査ログを書き込む。書き込み自体が失敗してもアプリを止めない（warn のみ）。
 * これは audit_log への書き込み失敗時の扱いだけ。アップロード本処理は別途 throw する。
 * @param {object} entry
 */
async function writeAuditLog(entry) {
  try {
    const db = getFirestoreDb();
    if (!db) {
      console.warn('photoStorage.writeAuditLog: Firestore not configured');
      return;
    }
    const colRef = collection(db, 'boards/main/photo_audit_log');
    await addDoc(colRef, {
      ...entry,
      timestamp: serverTimestamp()
    });
  } catch (err) {
    // ここで throw してしまうと元のエラーを覆い隠す → warn だけに留める
    console.warn('photoStorage.writeAuditLog failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * フォルダ名を生成: `{assignee}_{maker} {car}_{number下4桁}`
 * 例: 個人 中島_トヨタ プリウス_5012
 *
 * @param {{ assignee?: string, maker?: string, car?: string, number?: string|number }} task
 * @returns {string}
 */
export function generateFolderName(task) {
  const t = task || {};
  const assignee = sanitizePathSegment(t.assignee, '未設定');
  const maker = sanitizePathSegment(t.maker, '未設定');
  const car = sanitizePathSegment(t.car, '未設定');
  const numberTail = lastFourDigits(t.number);
  return `${assignee}_${maker} ${car}_${numberTail}`;
}

/**
 * ファイル名を生成。
 *  - 画像: `{phase}_{YYYYMMDD}_{NNN}.{ext}`           例: IN_20260430_001.jpg
 *  - 動画(mp4/webm): `{phase}_{YYYYMMDD}.{ext}`        例: OUT_20260430.mp4
 *
 * @param {'IN'|'B'|'P'|'OUT'} phase
 * @param {Date} date
 * @param {number} sequenceNumber - 1始まり。動画では無視される
 * @param {string} [ext='jpg']
 * @returns {string}
 */
export function generateFilename(phase, date, sequenceNumber, ext = 'jpg') {
  if (!phase) throw new Error('generateFilename: phase is required');
  const dateStr = formatYYYYMMDD(date);
  const cleanExt = String(ext || 'jpg').toLowerCase().replace(/^\./, '');
  if (isVideoExt(cleanExt)) {
    return `${phase}_${dateStr}.${cleanExt}`;
  }
  const seq = Math.max(1, Number(sequenceNumber) || 1);
  const seqStr = String(seq).padStart(3, '0');
  return `${phase}_${dateStr}_${seqStr}.${cleanExt}`;
}

/**
 * 当日 (taskId, phase, dateStr) に対する次のシーケンス番号を取得（1始まり）。
 * Firestore `boards/main/tasks/{taskId}/photos` を query して
 * 同 phase かつ filename が `{phase}_{dateStr}_` で始まるものをカウント+1する。
 *
 * @param {string} taskId
 * @param {'IN'|'B'|'P'|'OUT'} phase
 * @param {string} dateStr - YYYYMMDD
 * @returns {Promise<number>}
 */
export async function getNextSequence(taskId, phase, dateStr) {
  if (!taskId) throw new Error('getNextSequence: taskId is required');
  if (!phase) throw new Error('getNextSequence: phase is required');
  if (!dateStr || !/^\d{8}$/.test(dateStr)) {
    throw new Error('getNextSequence: dateStr must be YYYYMMDD');
  }
  const db = getFirestoreDb();
  if (!db) throw new Error('getNextSequence: Firestore not configured');

  // フラットコレクション `boards/main/photos` に taskId フィールドで紐付け。
  // サブコレクション方式だと taskId ごとに index が必要になるためフラット化。
  const colRef = collection(db, 'boards/main/photos');
  const prefix = `${phase}_${dateStr}_`;
  const prefixEnd = `${phase}_${dateStr}_\uf8ff`;

  const q = query(
    colRef,
    where('taskId', '==', taskId),
    where('phase', '==', phase),
    where('filename', '>=', prefix),
    where('filename', '<=', prefixEnd)
  );
  const snap = await getDocs(q);
  // deletedAt の有無に関わらず連番は維持する（番号衝突を避けるため）
  return snap.size + 1;
}

/**
 * 写真／動画をアップロードする。
 *
 *   1. 入力検証
 *   2. 連番取得（画像のみ）
 *   3. filename / folderName / storagePath 生成
 *   4. Storage アップロード（resumable, onProgress 通知）
 *   5. アップ完了 await
 *   6. width/height 取得（image）/ duration 取得（video）
 *   7. Firestore メタデータ書き込み（boards/main/tasks/{taskId}/photos）
 *   8. audit_log 'create' 書き込み
 *   9. return { photoId, storagePath, filename, folderName }
 *
 * 失敗時は audit_log 'create_failed' を書いてから 元のエラーを再 throw する。
 *
 * @param {Blob} blob
 * @param {{
 *   task: { id: string, assignee?: string, maker?: string, car?: string, number?: string|number },
 *   phase: 'IN'|'B'|'P'|'OUT',
 *   mediaType: 'image'|'video',
 *   user: { uid: string, displayName?: string },
 *   onProgress?: (percent: number) => void
 * }} options
 * @returns {Promise<{ photoId: string, storagePath: string, filename: string, folderName: string }>}
 */
export async function uploadPhoto(blob, options) {
  // 1. 入力検証 ---------------------------------------------------------------
  const opts = options || {};
  const task = opts.task;
  const phase = opts.phase;
  const mediaType = opts.mediaType;
  const user = opts.user;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  if (!blob || typeof blob !== 'object' || typeof blob.size !== 'number') {
    throw new Error('uploadPhoto: blob must be a Blob/File');
  }
  if (typeof Blob !== 'undefined' && !(blob instanceof Blob)) {
    throw new Error('uploadPhoto: blob must be a Blob/File');
  }
  if (!task || !task.id) {
    throw new Error('uploadPhoto: task.id is required');
  }
  if (!phase || !['IN', 'B', 'P', 'OUT'].includes(phase)) {
    throw new Error('uploadPhoto: phase must be one of IN/B/P/OUT');
  }
  if (mediaType !== 'image' && mediaType !== 'video') {
    throw new Error('uploadPhoto: mediaType must be image or video');
  }
  // Firestore/Storage 初期化を確定させる（getFirestoreDb 経由で initializeApp 完了）
  const db = getFirestoreDb();
  if (!db) {
    throw new Error('uploadPhoto: Firestore is not configured');
  }

  // user.uid を解決: 引数で渡されてなければ Firebase Auth の currentUser から取得
  let resolvedUid = user && user.uid ? user.uid : null;
  let resolvedName = user && user.displayName ? user.displayName : (typeof user === 'string' ? user : '');
  if (!resolvedUid) {
    const auth = getFirebaseAuth();
    const fbUser = auth && auth.currentUser;
    if (fbUser && fbUser.uid) {
      resolvedUid = fbUser.uid;
      if (!resolvedName) resolvedName = fbUser.displayName || fbUser.email || '';
    }
  }
  if (!resolvedUid) {
    throw new Error('uploadPhoto: ログインが必要です（Firebase Auth に currentUser がありません）');
  }

  const taskId = task.id;
  const userId = resolvedUid;
  const userName = resolvedName;

  // 後で audit に使うためエラー文脈を最後まで握っておく
  let stage = 'init';
  let filename = null;
  let folderName = null;
  let storagePath = null;

  try {
    // 2-3. 連番取得＋ファイル名生成 -----------------------------------------
    stage = 'plan_filename';
    const now = new Date();
    const dateStr = formatYYYYMMDD(now);
    const ext = mediaType === 'video' ? 'mp4' : 'jpg';

    let sequenceNumber = 1;
    if (mediaType === 'image') {
      stage = 'get_next_sequence';
      sequenceNumber = await getNextSequence(taskId, phase, dateStr);
    }

    folderName = generateFolderName(task);
    filename = generateFilename(phase, now, sequenceNumber, ext);
    storagePath = `photos/${taskId}/${folderName}/${filename}`;

    // 4-5. Storage resumable upload ----------------------------------------
    stage = 'storage_upload';
    const storage = getFireStorage();
    const objectRef = storageRef(storage, storagePath);
    const contentType = blob.type || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
    const uploadTask = uploadBytesResumable(objectRef, blob, { contentType });

    await new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          if (onProgress && snapshot.totalBytes > 0) {
            const pct = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            try {
              onProgress(pct);
            } catch (cbErr) {
              // onProgress コールバックの例外でアップロードを止めない
              console.warn('uploadPhoto onProgress callback threw:', cbErr);
            }
          }
        },
        (err) => reject(err),
        () => resolve()
      );
    });

    // 6. メディア寸法/時間取得（失敗しても止めない） ----------------------------
    stage = 'probe_media';
    let width = null;
    let height = null;
    let durationSec = null;
    if (mediaType === 'image') {
      const dim = await readImageDimensions(blob);
      width = dim.width;
      height = dim.height;
    } else {
      durationSec = await readVideoDuration(blob);
    }

    // 7. Firestore メタデータ書き込み ----------------------------------------
    stage = 'firestore_metadata';
    const photosCol = collection(db, 'boards/main/photos');
    const docRef = await addDoc(photosCol, {
      taskId,
      filename,
      phase,
      mediaType,
      storagePath,
      folderName,
      fileSize: blob.size,
      width,
      height,
      durationSec,
      capturedAt: serverTimestamp(),
      capturedBy: userId,
      capturedByName: userName,
      deletedAt: null,
      deletedBy: null
    });
    const photoId = docRef.id;

    // 8. 監査ログ（成功） -----------------------------------------------------
    stage = 'audit_log_create';
    await writeAuditLog({
      photoId,
      taskId,
      action: 'create',
      userId,
      userName,
      metadata: {
        phase,
        mediaType,
        storagePath,
        filename,
        fileSize: blob.size
      }
    });

    // 9. return --------------------------------------------------------------
    return { photoId, storagePath, filename, folderName };
  } catch (err) {
    // 失敗 → audit に create_failed を必ず書く（書き込み自体の失敗は warn のみ）
    const errorMessage = (err && err.message) ? err.message : String(err);
    const errorCode = (err && err.code) ? err.code : null;
    await writeAuditLog({
      photoId: null,
      taskId,
      action: 'create_failed',
      userId,
      userName,
      metadata: {
        stage,
        errorMessage,
        errorCode,
        phase,
        mediaType,
        filename,
        folderName,
        storagePath
      }
    });
    console.error('uploadPhoto failed at stage', stage, err);
    throw err;
  }
}
