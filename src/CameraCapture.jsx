/**
 * BB鈑金版 カスタムカメラモーダル
 *
 * 車両カードからフルスクリーン起動 → 連続撮影（写真）／ 30秒上限（動画）
 * 撮影 Blob は photoStorage.uploadPhoto に渡す。1枚ずつ順次（並列禁止）。
 *
 * Props:
 *   open         : boolean
 *   task         : { id, assignee, maker, car, number }
 *   currentUser  : { uid, displayName }
 *   onClose      : () => void
 *   onPhotoSaved : ({ photoId, storagePath, filename, mediaType, phase }) => void
 *   onError      : (err: Error, ctx?: object) => void
 *
 * 実装ルール:
 *   - 手動 IME 制御禁止（このコンポーネントには文字入力なし）
 *   - catch(()=>{}) 禁止（必ず onError へ）
 *   - cleanup で MediaStream の全 track を必ず stop
 *   - open=false の時は null を返す
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Grid3x3,
  RotateCcw,
  Square,
  Video,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import { uploadPhoto } from './photoStorage';

// ---------- 定数 ----------
const VIDEO_MAX_MS = 30_000; // 30秒上限
// Cogni PhotoBase（jpg/jpeg/png対応・1案件100枚・1回20枚）への伝送を前提に
// 1枚あたり0.7〜1.5MBに収める設定。長辺2400px超は2000pxへ縮小ガード。
const JPEG_QUALITY = 0.85;
const MAX_LONG_SIDE = 2400;
const RESIZE_LONG_SIDE = 2000;
const PHASES = ['IN', 'B', 'P', 'OUT'];
const GRID_MODES = ['off', '3x3', 'stripe']; // 3段切替

// 板金ストライプ（鏡面反射の歪みを浮き上がらせる蛍光灯式）
const STRIPE_BG =
  'repeating-linear-gradient(0deg,' +
  ' rgba(255,255,255,0.18) 0px, rgba(255,255,255,0.18) 32px,' +
  ' rgba(0,0,0,0.18) 32px, rgba(0,0,0,0.18) 64px)';

export default function CameraCapture({
  open,
  task,
  currentUser,
  onClose,
  onPhotoSaved,
  onError,
}) {
  // ---------- refs ----------
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const trackRef = useRef(null); // video track（torch 制御用）
  const recorderRef = useRef(null); // MediaRecorder
  const recorderChunksRef = useRef([]); // recording chunks
  const recorderTimerRef = useRef(null); // 30秒自動 stop タイマ
  const queueRef = useRef([]); // アップロードキュー
  const queueRunningRef = useRef(false); // キュー実行中フラグ
  const mountedRef = useRef(true);
  const objectUrlsRef = useRef([]); // サムネ URL のクリーンアップ用

  // ---------- state ----------
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [mode, setMode] = useState('photo'); // 'photo' | 'video'
  const [phase, setPhase] = useState('IN');
  const [gridMode, setGridMode] = useState('off');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [recentThumbs, setRecentThumbs] = useState([]); // [{ id, url }]
  // 進捗（同期 ref と state を併用）
  const counterRef = useRef({ inFlight: 0, done: 0, failed: 0, total: 0 });
  const [progress, setProgress] = useState({ inFlight: 0, done: 0, failed: 0, total: 0 });
  const [failedItems, setFailedItems] = useState([]); // [{ id, blob, phase, mediaType }]

  // ----------------------------------------------------------------
  // 進捗カウンタ更新（ref → state を 1 source-of-truth に）
  // ----------------------------------------------------------------
  const syncProgress = useCallback(() => {
    if (!mountedRef.current) return;
    setProgress({ ...counterRef.current });
  }, []);

  // ----------------------------------------------------------------
  // サムネ追加
  // ----------------------------------------------------------------
  const pushThumb = useCallback((blob) => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.push(url);
    setRecentThumbs((prev) => {
      const next = [{ id: `${Date.now()}-${Math.random()}`, url }, ...prev].slice(0, 3);
      return next;
    });
  }, []);

  // ----------------------------------------------------------------
  // アップロードキュー（1 by 1）
  // ----------------------------------------------------------------
  const runQueue = useCallback(async () => {
    if (queueRunningRef.current) return;
    queueRunningRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current.shift();
        counterRef.current.inFlight += 1;
        syncProgress();
        try {
          const result = await uploadPhoto(item.blob, {
            task,
            phase: item.phase,
            mediaType: item.mediaType,
            user: currentUser,
            onProgress: () => {
              // 個別進捗は今は使わない（全体カウンタのみ表示）
            },
          });
          counterRef.current.inFlight -= 1;
          counterRef.current.done += 1;
          syncProgress();
          if (typeof onPhotoSaved === 'function') {
            onPhotoSaved({
              photoId: result.photoId,
              storagePath: result.storagePath,
              filename: result.filename,
              mediaType: item.mediaType,
              phase: item.phase,
            });
          }
        } catch (err) {
          counterRef.current.inFlight -= 1;
          counterRef.current.failed += 1;
          syncProgress();
          if (mountedRef.current) {
            setFailedItems((prev) => [...prev, item]);
          }
          if (typeof onError === 'function') {
            onError(err, { stage: 'upload', phase: item.phase, mediaType: item.mediaType });
          }
        }
      }
    } finally {
      queueRunningRef.current = false;
    }
  }, [task, currentUser, onPhotoSaved, onError, syncProgress]);

  const enqueue = useCallback(
    (blob, mediaType, phaseAtCapture) => {
      const item = {
        id: `${Date.now()}-${Math.random()}`,
        blob,
        mediaType,
        phase: phaseAtCapture,
      };
      counterRef.current.total += 1;
      syncProgress();
      queueRef.current.push(item);
      // fire-and-forget ではなく awaitable だが UI 側は気にしない
      runQueue();
    },
    [runQueue, syncProgress]
  );

  // ----------------------------------------------------------------
  // 写真キャプチャ（canvas で frame → JPEG）
  // ----------------------------------------------------------------
  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    // 高画素端末で長辺がMAX_LONG_SIDEを超える場合はRESIZE_LONG_SIDEへ縮小
    const longSide = Math.max(srcW, srcH);
    const scale = longSide > MAX_LONG_SIDE ? RESIZE_LONG_SIDE / longSide : 1;
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          if (typeof onError === 'function') {
            onError(new Error('canvas.toBlob returned null'), { stage: 'capture' });
          }
          return;
        }
        pushThumb(blob);
        enqueue(blob, 'image', phase);
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  }, [enqueue, onError, phase, pushThumb]);

  // ----------------------------------------------------------------
  // 動画録画
  // ----------------------------------------------------------------
  const pickVideoMime = () => {
    const mr = window.MediaRecorder;
    if (!mr || typeof mr.isTypeSupported !== 'function') return '';
    const candidates = [
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ];
    for (const m of candidates) {
      try {
        if (mr.isTypeSupported(m)) return m;
      } catch {
        // isTypeSupported が throw する実装は無視
      }
    }
    return '';
  };

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch (err) {
        if (typeof onError === 'function') {
          onError(err, { stage: 'recorder.stop' });
        }
      }
    }
    if (recorderTimerRef.current) {
      clearInterval(recorderTimerRef.current);
      recorderTimerRef.current = null;
    }
  }, [onError]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickVideoMime();
    let recorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      if (typeof onError === 'function') {
        onError(err, { stage: 'recorder.create' });
      }
      return;
    }
    recorderRef.current = recorder;
    recorderChunksRef.current = [];
    const phaseAtStart = phase;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        recorderChunksRef.current.push(ev.data);
      }
    };
    recorder.onerror = (ev) => {
      if (typeof onError === 'function') {
        onError(
          ev?.error instanceof Error ? ev.error : new Error('MediaRecorder error'),
          { stage: 'recorder.onerror' }
        );
      }
    };
    recorder.onstop = () => {
      const chunks = recorderChunksRef.current;
      recorderChunksRef.current = [];
      const type =
        recorder.mimeType ||
        (chunks[0] && chunks[0].type) ||
        'video/mp4';
      const blob = new Blob(chunks, { type });
      if (mountedRef.current) {
        setRecording(false);
        setRecordSec(0);
      }
      if (blob.size > 0) {
        enqueue(blob, 'video', phaseAtStart);
      }
    };

    try {
      recorder.start(1000); // 1秒ごとに dataavailable
    } catch (err) {
      if (typeof onError === 'function') {
        onError(err, { stage: 'recorder.start' });
      }
      return;
    }
    if (mountedRef.current) {
      setRecording(true);
      setRecordSec(0);
    }
    const startedAt = Date.now();
    recorderTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (mountedRef.current) {
        setRecordSec(Math.min(VIDEO_MAX_MS, elapsed) / 1000);
      }
      if (elapsed >= VIDEO_MAX_MS) {
        stopRecording();
      }
    }, 200);
  }, [enqueue, onError, phase, stopRecording]);

  // ----------------------------------------------------------------
  // シャッターボタン
  // ----------------------------------------------------------------
  const handleShutter = useCallback(() => {
    if (!cameraReady) return;
    if (mode === 'photo') {
      capturePhoto();
    } else {
      if (recording) {
        stopRecording();
      } else {
        startRecording();
      }
    }
  }, [cameraReady, mode, recording, capturePhoto, startRecording, stopRecording]);

  // ----------------------------------------------------------------
  // フラッシュ（torch）
  // ----------------------------------------------------------------
  const toggleTorch = useCallback(async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      if (mountedRef.current) setTorchOn(next);
    } catch {
      // 致命的ではない（onError は呼ばない）。UI に「非対応」を出す。
      if (mountedRef.current) {
        setTorchSupported(false);
        setTorchOn(false);
      }
    }
  }, [torchOn]);

  // ----------------------------------------------------------------
  // グリッド3段切替
  // ----------------------------------------------------------------
  const cycleGrid = useCallback(() => {
    setGridMode((g) => {
      const idx = GRID_MODES.indexOf(g);
      return GRID_MODES[(idx + 1) % GRID_MODES.length];
    });
  }, []);

  // ----------------------------------------------------------------
  // モード切替（撮影中の不整合防止）
  // ----------------------------------------------------------------
  const toggleMode = useCallback(() => {
    if (recording) return; // 録画中は切替禁止
    setMode((m) => (m === 'photo' ? 'video' : 'photo'));
  }, [recording]);

  // ----------------------------------------------------------------
  // 失敗アイテムのリトライ
  // ----------------------------------------------------------------
  const retryFailed = useCallback(() => {
    if (failedItems.length === 0) return;
    const items = failedItems;
    setFailedItems([]);
    // failed カウンタを戻して total はそのまま、再エンキュー
    counterRef.current.failed = Math.max(0, counterRef.current.failed - items.length);
    syncProgress();
    for (const it of items) {
      queueRef.current.push(it);
    }
    runQueue();
  }, [failedItems, runQueue, syncProgress]);

  // ----------------------------------------------------------------
  // 閉じる（録画中なら停止してから）
  // ----------------------------------------------------------------
  const handleClose = useCallback(() => {
    if (recording) {
      stopRecording();
    }
    if (typeof onClose === 'function') onClose();
  }, [recording, stopRecording, onClose]);

  // ----------------------------------------------------------------
  // open ↔ getUserMedia 起動 / cleanup
  // ----------------------------------------------------------------
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;

    // 起動時にローカル state をリセット
    setCameraReady(false);
    setCameraError(null);
    setRecording(false);
    setRecordSec(0);
    setTorchOn(false);
    setTorchSupported(false);
    counterRef.current = { inFlight: 0, done: 0, failed: 0, total: 0 };
    setProgress({ inFlight: 0, done: 0, failed: 0, total: 0 });
    setFailedItems([]);
    setRecentThumbs([]);
    queueRef.current = [];
    queueRunningRef.current = false;
    recorderChunksRef.current = [];

    (async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('このブラウザはカメラAPI(getUserMedia)に対応していません');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0] || null;
        trackRef.current = videoTrack;

        // torch サポート判定
        try {
          const caps =
            videoTrack && typeof videoTrack.getCapabilities === 'function'
              ? videoTrack.getCapabilities()
              : null;
          if (caps && 'torch' in caps && caps.torch) {
            setTorchSupported(true);
          } else {
            setTorchSupported(false);
          }
        } catch {
          // capabilities 非対応 → 非サポート扱い（致命的ではない）
          setTorchSupported(false);
        }

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.playsInline = true;
          video.muted = true;
          try {
            await video.play();
          } catch (err) {
            // iOS は user-gesture 起点なら通る。失敗しても表示自体は進める。
            if (typeof onError === 'function') {
              onError(err, { stage: 'video.play' });
            }
          }
        }
        if (mountedRef.current) setCameraReady(true);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err && err.name === 'NotAllowedError'
            ? 'カメラの利用が許可されていません。設定 > Safari > カメラ を確認してください。'
            : err && err.name === 'NotFoundError'
              ? '背面カメラが見つかりませんでした。'
              : err && err.message
                ? err.message
                : 'カメラを起動できませんでした';
        if (mountedRef.current) setCameraError(msg);
        if (typeof onError === 'function') {
          onError(err instanceof Error ? err : new Error(String(err)), {
            stage: 'getUserMedia',
          });
        }
      }
    })();

    // ----- cleanup: track 全停止・recorder 停止・タイマ解除・URL revoke -----
    return () => {
      cancelled = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // stop 失敗は無視（既に inactive 等）
        }
      }
      recorderRef.current = null;
      if (recorderTimerRef.current) {
        clearInterval(recorderTimerRef.current);
        recorderTimerRef.current = null;
      }
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            // track stop 失敗は致命ではない
          }
        });
      }
      streamRef.current = null;
      trackRef.current = null;
      const video = videoRef.current;
      if (video) {
        try {
          video.pause();
        } catch {
          // pause 失敗は無視
        }
        try {
          video.srcObject = null;
        } catch {
          // srcObject クリア失敗は無視
        }
      }
      objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      objectUrlsRef.current = [];
    };
  }, [open, onError]);

  // ----------------------------------------------------------------
  // HUD 表示用
  // ----------------------------------------------------------------
  const last4 = useMemo(() => {
    const n = task && task.number ? String(task.number) : '';
    return n.slice(-4);
  }, [task]);

  if (!open) return null;

  // ----------------------------------------------------------------
  // 描画
  // ----------------------------------------------------------------
  return (
    <div className="fixed inset-0 z-50 bg-black text-white select-none">
      {/* video preview */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
      />

      {/* グリッドオーバーレイ */}
      {gridMode === '3x3' && (
        <div className="absolute inset-0 pointer-events-none">
          {/* 縦線 2本 */}
          <div
            className="absolute top-0 bottom-0"
            style={{ left: '33.333%', width: 1, background: 'rgba(255,255,255,0.5)' }}
          />
          <div
            className="absolute top-0 bottom-0"
            style={{ left: '66.666%', width: 1, background: 'rgba(255,255,255,0.5)' }}
          />
          {/* 横線 2本 */}
          <div
            className="absolute left-0 right-0"
            style={{ top: '33.333%', height: 1, background: 'rgba(255,255,255,0.5)' }}
          />
          <div
            className="absolute left-0 right-0"
            style={{ top: '66.666%', height: 1, background: 'rgba(255,255,255,0.5)' }}
          />
        </div>
      )}
      {gridMode === 'stripe' && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: STRIPE_BG }}
          aria-hidden="true"
        />
      )}

      {/* 上部 HUD */}
      <div className="absolute top-0 left-0 right-0 px-3 pt-[env(safe-area-inset-top)]">
        <div className="flex items-start justify-between gap-2 pt-2">
          {/* 左: 直近サムネ3枚 */}
          <div className="flex gap-1">
            {recentThumbs.map((t) => (
              <img
                key={t.id}
                src={t.url}
                alt=""
                className="w-10 h-10 rounded object-cover border border-white/40"
              />
            ))}
          </div>

          {/* 中央: 車両情報 */}
          <div className="flex-1 mx-2">
            <div className="bg-black/60 rounded px-3 py-1.5 text-center backdrop-blur-sm">
              <div className="text-xs leading-tight">
                <span className="font-semibold">{task?.assignee || '-'}</span>
                <span className="mx-2 opacity-60">|</span>
                <span>
                  {task?.maker || ''} {task?.car || ''}
                </span>
                {last4 && (
                  <>
                    <span className="mx-2 opacity-60">|</span>
                    <span className="font-mono">…{last4}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 右: 写真/動画トグル + 閉じる */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMode}
              disabled={recording}
              className={[
                'rounded-full p-2 backdrop-blur-sm',
                recording ? 'opacity-40' : '',
                mode === 'photo' ? 'bg-white/15' : 'bg-red-500/70',
              ].join(' ')}
              aria-label="写真/動画 切替"
            >
              {mode === 'photo' ? (
                <Camera className="w-5 h-5" />
              ) : (
                <Video className="w-5 h-5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-2 bg-white/15 backdrop-blur-sm"
              aria-label="閉じる"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* フェーズタグ */}
        <div className="flex justify-center mt-2">
          <div className="inline-flex bg-black/50 rounded-full p-1 backdrop-blur-sm">
            {PHASES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPhase(p)}
                className={[
                  'px-4 py-1 text-sm rounded-full font-semibold transition-colors',
                  phase === p ? 'bg-blue-500 text-white' : 'text-white/80',
                ].join(' ')}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* 録画中インジケータ */}
        {recording && (
          <div className="flex justify-center mt-2">
            <div className="bg-red-600/80 rounded-full px-3 py-1 text-xs font-mono flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              REC {recordSec.toFixed(1)}s / 30s
            </div>
          </div>
        )}
      </div>

      {/* カメラエラー表示 */}
      {cameraError && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="bg-black/80 rounded-lg p-6 max-w-sm text-center">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-2" />
            <p className="text-sm mb-4">{cameraError}</p>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded bg-white text-black text-sm font-semibold"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* 下部コントロール */}
      <div
        className="absolute bottom-0 left-0 right-0 px-6 pb-[env(safe-area-inset-bottom)]"
      >
        {/* 進捗 / 失敗バッジ */}
        <div className="flex items-center justify-center gap-2 mb-2 min-h-[28px]">
          {progress.total > 0 && progress.inFlight > 0 && (
            <div className="bg-black/60 rounded px-3 py-1 text-xs backdrop-blur-sm">
              ⌛ 保存中 ({progress.done}/{progress.total})
            </div>
          )}
          {progress.total > 0 && progress.inFlight === 0 && progress.failed === 0 && (
            <div className="bg-black/60 rounded px-3 py-1 text-xs backdrop-blur-sm">
              ✓ {progress.done}件 保存済み
            </div>
          )}
          {progress.failed > 0 && (
            <button
              type="button"
              onClick={retryFailed}
              className="bg-red-600/90 rounded px-3 py-1 text-xs font-semibold flex items-center gap-1.5"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              {progress.failed}件 失敗
              <RotateCcw className="w-3.5 h-3.5 ml-1" />
              リトライ
            </button>
          )}
        </div>

        {/* 操作行: グリッド / シャッター / フラッシュ */}
        <div className="flex items-center justify-between pb-6">
          {/* 左: グリッド3段切替 */}
          <button
            type="button"
            onClick={cycleGrid}
            className="flex flex-col items-center gap-0.5 w-16"
            aria-label="グリッド切替"
          >
            <div className="rounded-full p-3 bg-white/10 backdrop-blur-sm">
              <Grid3x3 className="w-6 h-6" />
            </div>
            <span className="text-[10px] opacity-80">
              {gridMode === 'off' ? 'OFF' : gridMode === '3x3' ? '3x3' : '鈑金'}
            </span>
          </button>

          {/* 中央: シャッター */}
          <button
            type="button"
            onClick={handleShutter}
            disabled={!cameraReady || !!cameraError}
            className="relative w-20 h-20 rounded-full flex items-center justify-center disabled:opacity-40"
            aria-label={
              mode === 'photo'
                ? '撮影'
                : recording
                  ? '録画停止'
                  : '録画開始'
            }
          >
            <span className="absolute inset-0 rounded-full border-4 border-white" />
            {mode === 'photo' && (
              <span className="w-16 h-16 rounded-full bg-white" />
            )}
            {mode === 'video' && !recording && (
              <span className="w-16 h-16 rounded-full bg-red-500" />
            )}
            {mode === 'video' && recording && (
              <Square className="w-8 h-8 text-red-500 fill-red-500" />
            )}
          </button>

          {/* 右: フラッシュ */}
          <button
            type="button"
            onClick={toggleTorch}
            disabled={!torchSupported}
            className="flex flex-col items-center gap-0.5 w-16 disabled:opacity-40"
            aria-label="フラッシュ"
          >
            <div
              className={[
                'rounded-full p-3 backdrop-blur-sm',
                torchOn ? 'bg-yellow-400/90 text-black' : 'bg-white/10',
              ].join(' ')}
            >
              {torchOn ? (
                <Zap className="w-6 h-6" />
              ) : (
                <ZapOff className="w-6 h-6" />
              )}
            </div>
            <span className="text-[10px] opacity-80">
              {torchSupported ? (torchOn ? 'ON' : 'OFF') : '非対応'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
