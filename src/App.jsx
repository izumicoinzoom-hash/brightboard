import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  AlertTriangle, Search, Settings, Bell, ChevronDown, ChevronLeft, ChevronRight, Layout,
  Car, PaintRoller, Wrench, X, FileText, CheckSquare, Paperclip, Truck, Calendar, MessageCircle, Pencil, Mailbox, History,
  Camera as CameraIcon,
  CheckCircle2
} from 'lucide-react';
import CameraCapture from './CameraCapture';
import { seedDemoCards, clearDemoCards } from './devSeedData';
import {
  getFirebaseAuth,
  getFirestoreDb,
  isFirebaseConfigured,
  isMobileOrNarrow,
  signInWithGoogle,
  handleRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  subscribeCollection,
  upsertDocument,
  deleteDocument
} from './firebase';
import { IMEInput, IMETextarea } from './IMEInput.jsx';
import { InvoiceModal, InvoiceSettingsPanel } from './InvoiceModal.jsx';

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

// 滞在時間フォーマット: ISO日時文字列から経過時間を短縮表示
const formatElapsedTime = (isoString) => {
  if (!isoString) return '';
  try {
    const ms = Date.now() - new Date(isoString).getTime();
    if (ms < 0 || Number.isNaN(ms)) return '';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days >= 1) return `${days}日`;
    return `${hours}h`;
  } catch { return ''; }
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

// かな検索用: ひらがな・カタカナを同一視して比較するために正規化
const normalizeKana = (str) => {
  if (!str) return '';
  return str.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  ).toLowerCase();
};

const ENTRY_PRIMARY_OPTIONS = ['個人', '保険', '業者', '代協'];
const ENTRY_SECONDARY_PRESETS = {
  業者: ['ヤナセ', 'イマムラ', 'カーポリッシュ'],
  保険: [
    '東京海上日動',
    '損保ジャパン',
    '三井住友海上',
    'あいおいニッセイ同和',
    'JA共済',
    'ソニー損保',
    'その他'
  ]
};

const getTaskDateForGrouping = (task) => task.outDate || task.inDate || '';

// 代車の貸出経過日数・予定日数・超過判定・長期判定を計算する
// ongoing: 納車日が未設定なら「今日まで」で計算。入庫日もなければ null を返す
const computeLoanerDayInfo = (task) => {
  if (!task || !task.loanerType || task.loanerType === 'none') return null;
  const start = task.inDate;
  if (!start) return { elapsedDays: null, plannedDays: task.plannedDays ?? null, isOverrun: false, isLongTerm: false };
  const endStr = task.outDate || new Date().toISOString().slice(0, 10);
  const elapsed = Math.max(1, Math.ceil((new Date(endStr) - new Date(start)) / 86400000) + 1);
  const planned = (task.plannedDays === 0 || task.plannedDays) ? Number(task.plannedDays) : null;
  const isOverrun = planned != null && planned > 0 && elapsed > planned;
  const isLongTerm = elapsed >= 10;
  return { elapsedDays: elapsed, plannedDays: planned, isOverrun, isLongTerm };
};

const getWeekInfo = (dateStr) => {
  if (!dateStr) return null;
  const base = new Date(dateStr);
  if (Number.isNaN(base.getTime())) return null;
  const day = base.getDay();
  const diffToMonday = (day + 6) % 7;
  const start = new Date(base);
  start.setDate(base.getDate() - diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const toLabel = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;
  return {
    key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
    label: `${toLabel(start)}〜${toLabel(end)}`,
    start,
  };
};

// 添付ファイル: { type: 'pdf'|'image', name: string, data: string }（data は dataURL または画像URL）
const isImageType = (mime) => (mime || '').startsWith('image/');
// 画像ファイルは Firestore の制限に収まるよう、クライアント側で縮小・圧縮してから dataURL 化する
const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    if (!isImageType(file.type)) {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
      return;
    }

    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const maxSize = 1280; // 長辺最大ピクセル
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            const scale = Math.min(maxSize / width, maxSize / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.7);
          resolve(compressed);
        } catch (err) {
          // 失敗した場合は元のデータをそのまま使う
          resolve(r.result);
        }
      };
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
      img.src = r.result;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });

// --- 車両マスターデータ ---
// 国産メーカーは提供データに基づき車種を登録（追加・削除済み）
const CAR_MODELS = {
  // --- 国産メーカー ---
  "トヨタ": [
    "2000GT", "bB", "bZ4X", "FJクルーザー", "GR86", "GRカローラ", "GRスープラ", "GRヤリス", "iQ", "Ist (イスト)", "MIRAI", "MR-S", "MR2", "RAV4", "WiLL Cypha", "WiLL Vi", "WiLL VS",
    "アクア", "アバロン", "アベンシス", "アベンシス ワゴン", "アリオン", "アルテッツァ", "アルテッツァ ジータ", "アルファード", "アレックス", "イプサム", "ヴァンガード", "ウィッシュ", "ヴィッツ", "ウインダム", "ヴェルファイア", "エスクァイア", "エスティマ", "エスティマ エミーナ", "エスティマ ルシーダ", "オーパ", "オーリス", "オリジン", "ガイア",
    "カムリ", "カムリ グラシア", "カリーナ", "カリーナED", "カルディナ", "カレン", "カローラ", "カローラ II", "カローラ アクシオ", "カローラ クロス", "カローラ スポーツ", "カローラ セレス", "カローラ ツーリング", "カローラ ツーリングワゴン", "カローラ フィールダー", "カローラ ランクス", "カローラ レビン", "キャバリエ", "クイックデリバリー", "クラシック", "クラウン", "クラウン エステート", "クラウン クロスオーバー", "クラウン スポーツ", "クラウン セダン", "クラウン マジェスタ", "グランエース", "グランビア", "クルーガー", "クレスタ", "コースター", "コペン GR SPORT", "コルサ", "コロナ", "コロナ EXiV", "コロナ プレミオ",
    "サイノス", "サクシード バン", "サクシード ワゴン", "シエンタ", "ジャパンタクシー", "スープラ", "スターレット", "スパーキー", "スプリンター", "スプリンター カリブ", "スプリンター トレノ", "スプリンター マリノス", "スペイド", "セプター", "セリカ", "セルシオ", "センチュリー", "センチュリー（SUVタイプ）", "ソアラ",
    "ターセル", "ダイナ カーゴ", "ダイナ ダンプ", "タウンエース トラック", "タウンエース ノア", "タウンエース バン", "タンク", "チェイサー", "ツーリングハイエース", "デュエット", "ナディア", "ノア",
    "ハイエース コミューター", "ハイエース トラック", "ハイエース バン", "ハイエース ワゴン", "ハイラックス", "ハイラックス サーフ", "パッソ", "ハリアー", "ビスタ", "ビスタ アルデオ", "ピクシス エポック", "ピクシス ジョイ", "ピクシス スペース", "ピクシス トラック", "ピクシス バン", "ピクシス メガ", "ファンカーゴ", "プラッツ", "プリウス", "プリウス PHV", "プリウスα", "ブリザード", "ブレイド", "ブレビス", "プログレ", "プロナード", "プロボックス バン", "プロボックス ワゴン", "ベルタ", "ポルテ",
    "マークII", "マークII クオリス", "マークII ブリット", "マークX", "マークX ジオ", "マスターエース サーフ", "メガクルーザー", "ヤリス", "ヤリス クロス", "ライズ", "ライトエース トラック", "ライトエース ノア", "ライトエース バン", "ラウム", "ラクティス", "ラッシュ", "ランドクルーザー 250", "ランドクルーザー 300", "ランドクルーザー 70", "ランドクルーザー プラド", "ルーミー", "レジアス", "レジアスエース"
  ],
  "レクサス": [
    "CT", "ES", "GS", "GS F", "GX", "HS", "IS", "IS F", "LC", "LFA", "LM", "LS", "LX", "NX", "RC", "RC F", "RX", "RZ", "S", "TX", "UX"
  ],
  "日産": [
    "180SX", "AD", "AD エキスパート", "AD バン", "AD ワゴン", "Be-1", "EXA (エクサ)", "KIX (軽自動車)", "NISSAN GT-R", "NV100クリッパー", "NV150 AD", "NV200バネット", "NV350キャラバン",
    "アトラス", "アベニール", "アリア", "インフィニティQ45", "ウイングロード", "エクストレイル", "エスカルゴ", "エルグランド", "オッティ", "キックス", "キューブ", "キューブ キュービック", "クルー", "クリッパー", "クリッパー トラック", "クリッパー バン", "クリッパー リオ", "グロリア", "サクラ", "サニー", "サファリ", "シーマ", "シルビア", "ジューク", "スカイライン", "スカイライン GT-R", "スカイライン クーペ", "スカイライン クロスオーバー", "ステージア", "セドリック", "セフィーロ", "セレナ", "ダットサン トラック", "ティーダ", "ティーダ ラティオ", "ティーノ", "ティアナ", "テラノ", "デイズ", "デイズ ルークス", "デュアリス", "ノート", "ノート オーラ", "パオ", "パサージュ", "パルサー", "ピノ", "フィガロ", "フェアレディZ", "フーガ", "ブルーバード", "ブルーバード シルフィ", "プリメーラ", "プレサージュ", "プレジデント", "マーチ", "マキシマ", "ムラーノ", "モコ", "ラシーン", "ラフェスタ", "ラルゴ", "リーフ", "リバティ", "ルークス", "ルネッサ", "レパード", "ローレル", "日産クリッパー", "日産クリッパー トラック", "日産クリッパー リオ"
  ],
  "ホンダ": [
    "1300", "CR-V", "CR-X", "CR-Z", "HR-V", "MDX", "N-BOX", "N-BOX CUSTOM", "N-BOX SLASH", "N-BOX+", "N-ONE", "N-VAN", "N-VAN e:", "N-WGN", "N-WGN CUSTOM", "NSX", "S2000", "S500", "S600", "S660", "S800", "WR-V", "Z", "ZR-V",
    "アヴァンシア", "アクティ トラック", "アクティ バン", "アコード", "アコード ツアラー", "アコード ワゴン", "アスコット", "アスコット イノーバ", "インサイト", "インスパイア", "インテグラ", "エディックス", "エリシオン", "エレメント", "オデッセイ", "オルティア", "キャパ", "クロスロード", "コンチェルト", "ザッツ", "シティ", "シビック", "シビック TYPE R", "シビック シャトル", "シビック フェリオ", "シャトル", "ジェイド", "ステップバン", "ステップワゴン", "ストリーム", "セイバー", "ゼスト", "ゼスト スパーク", "トゥデイ", "トルネオ", "ドマーニ", "バモス", "バモス ホビオ", "ビート", "ビガー", "フィット", "フィット アリア", "フィット シャトル", "フリード", "フリード スパイク", "プレリュード", "ホライゾン", "モビリオ", "モビリオ スパイク", "ライフ", "ラグレイト", "レジェンド", "ロゴ"
  ],
  "マツダ": [
    "AZ-1", "AZ-オフロード", "AZ-ワゴン", "CX-3", "CX-30", "CX-4", "CX-5", "CX-60", "CX-7", "CX-8", "CX-80", "MAZDA2", "MAZDA3 セダン", "MAZDA3 ファストバック", "MAZDA6", "MPV", "MS-6", "MS-8", "MS-9", "MX-30", "MX-30 Rotary-EV", "RX-7", "RX-8",
    "アクセラ", "アクセラ スポーツ", "アテンザ", "アテンザ スポーツ", "アテンザ ワゴン", "カペラ", "カペラ ワゴン", "キャロル", "クレフ", "クロノス", "コスモ", "サバンナ", "サバンナ RX-7", "スクラム トラック", "スクラム バン", "スクラム ワゴン", "センティア", "タイタン", "トリビュート", "ファミリア", "ファミリア バン", "ファミリア ワゴン", "フレア", "フレア クロスオーバー", "フレア ワゴン", "プレマシー", "プロシード", "ベリーサ", "ペルソナ", "ボンゴ トラック", "ボンゴ バン", "ボンゴ フレンディ", "ミレーニア", "ランティス", "ルーチェ", "レビュー", "ロードスター", "ロードスター RF"
  ],
  "スバル": [
    "360", "BRZ", "R1", "R2", "WRX S4", "WRX STI",
    "アルシオーネ", "アルシオーネ SVX", "インプレッサ", "インプレッサ G4", "インプレッサ WRX", "インプレッサ XV", "インプレッサ スポーツ", "エクシーガ", "エクシーガ クロスオーバー7", "クロストレック", "サンバー トラック", "サンバー バン", "シフォン", "ジャスティ", "ステラ", "ソルテラ", "ソルテラデック", "トラヴィック", "トレジア", "ドミンゴ", "フォレスター", "プレオ", "プレオ プラス", "ルクラ", "レオーネ", "レガシィ", "レガシィ B4", "レガシィ アウトバック", "レガシィ ツーリングワゴン", "レックス", "レヴォーグ", "レヴォーグ レイバック"
  ],
  "スズキ": [
    "Kei", "MRワゴン", "SX4", "SX4 S-CROSS", "X-90",
    "アルト", "アルト エコ", "アルト ラパン", "アルト ラパン LC", "アルト ワークス", "イグニス", "エスクード", "エブリイ", "エブリイ ランディ", "エブリイ ワゴン", "カプチーノ", "カルタス", "キザシ", "キャラ", "キャリイ", "クロスビー", "グランド エスクード", "シボレー クルーズ", "ジムニー", "ジムニー シエラ", "ジムニー ワイド", "スイフト", "スイフト スポーツ", "スーパー キャリイ", "スプラッシュ", "スペーシア", "スペーシア カスタム", "スペーシア ギア", "スペーシア ベース", "セルボ", "ソリオ", "ソリオ バン", "ディット", "ツインパレット", "フロンテ", "フロンクス", "マイティボーイ", "ランディ", "ワゴンR", "ワゴンR カスタムZ", "ワゴンR スマイル", "ワゴンR スティングレー", "ワゴンR ソリオ", "ワゴンR プラス"
  ],
  "ダイハツ": [
    "YRV", "アトレー", "アトレー ワゴン", "アプローズ", "ウェイク", "エッセ", "オプティ", "キャスト", "キャスト アクティバ", "キャスト スタイル", "キャスト スポーツ", "クー", "グランマックス カーゴ", "グランマックス トラック", "コペン", "シャレード", "ストーリア", "ソニカ", "タフト", "タント", "タント エグゼ", "タント カスタム", "タント ファンクロス", "テリオス", "テリオス キッド", "テリオス ルキア", "トール", "ネイキッド", "ハイゼット カーゴ", "ハイゼット キャディー", "ハイゼット トラック", "パイザー", "ビーゴ", "ブーン", "ブーン ルミナス", "マックス (MAX)", "ミラ", "ミラ アヴィ", "ミラ イース", "ミラ ココア", "ミラ ジーノ", "ミラ トコット", "ムーヴ", "ムーヴ カスタム", "ムーヴ キャンバス", "ムーヴ コンテ", "ムーヴ ラテ", "ラガー", "ガーリー", "ロッキー"
  ],
  "三菱": [
    "FTO", "GTO", "i (アイ)", "i-MiEV", "RVR", "アウトランダー", "アウトランダー PHEV", "エアトレック", "エクリプス", "エクリプス クロス", "エクリプス クロス PHEV", "ギャラン", "ギャラン フォルティス", "グランディス", "コルト", "コルト プラス", "スタリオン", "スペースギア", "タウンボックス", "チャレンジャー", "ディアマンテ", "ディオン", "ディンゴ", "デボネア", "デリカ D:2", "デリカ D:2 カスタム", "デリカ D:3", "デリカ D:5", "デリカ スターワゴン", "デリカ スペースギア", "デリカ トラック", "デリカ バン", "デリカ ミニ", "トッポ", "トッポ BJ", "トライトン", "パジェロ", "パジェロ イオ", "パジェロ ジュニア", "パジェロ ミニ", "プラウディア", "ミニカ", "ミニキャブ EV", "ミニキャブ トラック", "ミニキャブ バン", "ミラージュ", "ミラージュ ディンゴ", "ランサー", "ランサー エボリューション", "ランサー カーゴ", "ランサー セディア", "レグナム", "eK アクティブ", "eK カスタム", "eK クラッシィ", "eK クロス", "eK クロス EV", "eK スペース", "eK スポーツ", "eK ワゴン"
  ],
  "光岡自動車": [
    "M55 (エムダブルファイブ)", "オロチ", "ガリュー", "ガリュー クラシック", "ガリュー204", "キュート", "ゼロワン", "ニュエラ", "バディ", "ヒミコ", "ビュート", "ビュート ストーリー", "マイクロ", "ラセード", "リューギ", "リューギ ワゴン", "レイ", "ロックスター"
  ],

  // --- ドイツ車 ---
  "メルセデス・ベンツ": [
    "Aクラス", "Bクラス", "Cクラス", "Eクラス", "Sクラス", "CLS",
    "GLA", "GLB", "GLC", "GLE", "GLS", "Gクラス",
    "SL", "SLC", "AMG GT", "Vクラス",
    "EQA", "EQB", "EQC", "EQE", "EQS"
  ],
  "BMW": [
    "1シリーズ", "2シリーズ", "3シリーズ", "4シリーズ", "5シリーズ", "7シリーズ", "8シリーズ",
    "X1", "X2", "X3", "X4", "X5", "X6", "X7",
    "M2", "M3", "M4", "M5", "M8",
    "i3", "i4", "iX", "i7"
  ],
  "アウディ": [
    "A1", "A3", "A4", "A5", "A6", "A7", "A8",
    "Q2", "Q3", "Q5", "Q7", "Q8",
    "TT", "R8", "e-tron"
  ],
  "フォルクスワーゲン": [
    "up!", "ポロ", "ゴルフ", "パサート", "ティグアン", "T-Roc", "T-Cross", "アルテオン", "ビートル"
  ],
  "ポルシェ": [
    "911", "718ボクスター", "718ケイマン", "パナメーラ", "マカン", "カイエン", "タイカン"
  ],

  // --- イギリス ---
  "ジャガー": [
    "XE", "XF", "XJ", "F-PACE", "E-PACE", "I-PACE", "F-TYPE"
  ],
  "ランドローバー": [
    "レンジローバー", "レンジローバースポーツ", "レンジローバーイヴォーク",
    "ディスカバリー", "ディフェンダー"
  ],
  "MINI": [
    "クラシックミニ", "3ドア", "5ドア", "クラブマン", "クロスオーバー"
  ],
  "ベントレー": [
    "コンチネンタルGT", "フライングスパー"
  ],
  "ロールス・ロイス": [
    "ファントム", "ゴースト", "カリナン"
  ],
  "アストンマーティン": [
    "DB11", "ヴァンテージ", "DBX"
  ],

  // --- イタリア・フランス・スウェーデン ---
  "フィアット": [
    "500", "パンダ"
  ],
  "アバルト": [
    "595"
  ],
  "アルファロメオ": [
    "ジュリア", "ステルヴィオ", "トナーレ", "ミト", "ジュリエッタ"
  ],
  "マセラティ": [
    "ギブリ", "レヴァンテ"
  ],
  "フェラーリ": [
    "ローマ", "296", "SF90"
  ],
  "ランボルギーニ": [
    "ウラカン", "ウルス"
  ],
  "プジョー": [
    "208", "308", "508", "2008", "3008", "5008"
  ],
  "ルノー": [
    "ルーテシア", "メガーヌ", "カングー", "トゥインゴ", "キャプチャー"
  ],
  "シトロエン": [
    "C3", "C4", "C5エアクロス", "ベルランゴ"
  ],
  "DS": [
    "DS3", "DS7"
  ],
  "ボルボ": [
    "XC40", "XC60", "XC90", "V60", "V90", "S60"
  ],

  // --- アメリカ ---
  "シボレー": [
    "コルベット", "カマロ", "タホ", "サバーバン", "シルバラード", "アストロ"
  ],
  "キャデラック": [
    "エスカレード", "CT5", "XT5"
  ],
  "フォード": [
    "マスタング", "エクスプローラー", "ブロンコ", "F-150"
  ],
  "ジープ": [
    "ラングラー", "チェロキー", "グランドチェロキー", "レネゲード", "コンパス"
  ],
  "ダッジ": [
    "チャレンジャー", "チャージャー", "デュランゴ"
  ],
  "テスラ": [
    "モデルS", "モデル3", "モデルX", "モデルY"
  ],

  // --- 韓国・中国 ---
  "ヒョンデ": [
    "アイオニック5", "ネッソ", "コナ"
  ],
  "BYD": [
    "ATTO 3", "ドルフィン", "シール"
  ],

  // その他
  "その他": ["その他車種（手入力）"]
};

// --- 担当者マスター ---
// 受付担当者はログインユーザーに固定せず、任意の一覧から選択する（初期値はFirestoreで各PC共通に同期される）
// 以下の4名は受付担当者として必ず含め、Firestore で消えないようにする
const RECEPTION_STAFF_OPTIONS = ['米田', '鶴田', 'あすか', '佃'];
const BODY_STAFF_OPTIONS = ['木下', '竹馬', 'チャス', 'アビアン'];   // 板金担当者
const PAINT_STAFF_OPTIONS = ['野中', '小田', '佐藤', 'アグン', 'リズキ'];    // 塗装担当者

// 受付担当者リストに必ず含める4名をマージ（Firestore が空でも消えないようにする）
function ensureReceptionStaffBase(list) {
  const base = Array.isArray(list) ? list : [];
  const extra = base.filter((s) => typeof s === 'string' && !RECEPTION_STAFF_OPTIONS.includes(s));
  return [...RECEPTION_STAFF_OPTIONS, ...extra];
}

// --- カードの色オプション（全コンポーネント共通）---
const CARD_COLOR_OPTIONS = ['bg-white', 'bg-cyan-300', 'bg-yellow-400', 'bg-gray-100', 'bg-red-100'];

// --- 更新履歴 ---
const CHANGELOG = [
  {
    date: '2026-04-17',
    version: 'v1.5.0',
    items: [
      'レンタル会社マスタを追加（設定→レンタル会社マスタから管理。他社レンタカー会社名をプルダウンから選択可）',
      '予定貸出日数（plannedDays）をカードに設定可能に。超過時はバッジが赤く表示',
      'バッジ表示に「n/m日」形式の経過/予定日数を表示（10日以上の長期貸出は 📌 でピン留め）',
      '代車ガントチャート画面に「代車利用一覧」を追加（代車種別フィルタ・貸出日数降順ソート・レンタル会社グループ化）',
    ]
  },
  {
    date: '2026-04-01',
    version: 'v1.4.0',
    items: [
      '他社レンタカー選択時にテキスト入力（会社名）に変更',
      'カードバッジ表記を分類: 代車=「代」、自社レンタカー=「レ」、他社レンタカー=「他」',
      '他社レンタカーの貸出日数をバッジに自動表示',
    ]
  },
  {
    date: '2026-03-30',
    version: 'v1.3.0',
    items: [
      'キーボード入力不能障害を修正（IMEInput compositionイベント制御の問題）',
      '外部スクリプト（GIS）の常駐読み込みを廃止',
    ]
  },
  {
    date: '2026-03-28',
    version: 'v1.2.0',
    items: [
      '請求書作成機能を追加',
      'サイクルタイム計測（入庫帳・納車帳・サイクルタイム帳票）を追加',
      'GAS連携による月別シート自動分割',
    ]
  },
  {
    date: '2026-03-20',
    version: 'v1.1.0',
    items: [
      '代車ガントチャート（貸出状況の可視化）を追加',
      '代車マスタ設定パネルを追加',
      'カードと代車予約の自動連動',
      '車検期限3日前からの自動除外',
    ]
  },
  {
    date: '2026-03-01',
    version: 'v1.0.0',
    items: [
      'BrightBoard 初期リリース',
      'カンバンボード（入庫〜納車の工程管理）',
      'Firebaseリアルタイム同期',
      'Googleカレンダー連携',
      'インドネシア語切り替え',
    ]
  },
];

// --- 代車・レンタカー マスター ---
const LOANER_OPTIONS = [
  { id: 'none', label: '不要 (なし)' },
  { id: 'loaner_k', label: '代車 (軽自動車)' },
  { id: 'loaner_n', label: '代車 (普通車)' },
  { id: 'rental', label: 'レンタカー手配' },
  { id: 'other_rental', label: '他社レンタカー' }
];

// ガントチャート用 フリートデータ（社用車・レンタカー）
const FLEET_CARS = [
  // 既存
  { id: 'f1', name: 'N-BOX (熊本580あ1234)', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'f2', name: 'ミライース (熊本580い5678)', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'f3', name: 'アクア (熊本500う9012)', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'f4', name: 'ノート (熊本500え3456)', type: '普通車', status: 'maintenance', inspectionExpiry: '' },
  { id: 'r1', name: 'レンタカー枠 A', type: 'レンタカー', status: 'active', inspectionExpiry: '' },
  { id: 'r2', name: 'レンタカー枠 B', type: 'レンタカー', status: 'active', inspectionExpiry: '' },

  // 追加：代車マスター（車検満了日は一旦空）
  { id: 'k1', name: 'ワゴンR 9092', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'k2', name: 'eKワゴン 5174', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'k3', name: 'ミライース 1152 ブルー', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'k4', name: 'ミライース 3421', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'k5', name: 'N BOX 401', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'k6', name: 'ピクシスエポック 2533', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'k7', name: 'デミオ 6724 ブルー', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'k8', name: 'ワゴンR 8257', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'k9', name: 'スイフト 2826 ブラック', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'k10', name: 'スイフト 9554 ホワイト', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'k11', name: 'ライトエース 1637', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'k12', name: 'パッソ 357 レッド', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'k13', name: 'パッソ 8355 レッド', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'k14', name: 'プリウス 8510 ブラック', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'k15', name: 'シエンタ 1815', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'k16', name: 'ヴィッツ 4214 ホワイト', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'k17', name: 'ヴィッツ 7641 シルバー', type: '普通車', status: 'active', inspectionExpiry: '' },
  { id: 'k18', name: 'キャリィ 3539 ホワイト', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'k19', name: 'ミライース 6082', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'k20', name: 'アルト 6084', type: '軽自動車', status: 'active', inspectionExpiry: '' },
  { id: 'k21', name: 'ノア 2883 ゴールド', type: '普通車', status: 'active', inspectionExpiry: '' },
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

// --- ボード設定データ（表示順: 入庫 → 全作業 → 鈑金 → 塗装 → 納車 → 迷子）---
// 列の statuses: 省略時は [id] として扱い、複数指定時はそのいずれかの status のタスクを表示。ドロップ時は statuses[0] に更新。
const BOARD_ORDER = ['planning', 'main', 'body', 'paint', 'delivery', 'orphan'];
const BOARDS = {
  planning: { id: 'planning', title: '予約管理', columns: [ { id: 'unscheduled', name: '入庫日未定' }, { id: 'mon', name: '月' }, { id: 'tue', name: '火' }, { id: 'wed', name: '水' }, { id: 'thu', name: '木' }, { id: 'fri', name: '金' }, { id: 'sat', name: '土' }, { id: 'sun', name: '日' }, { id: 'received', name: '入庫済み' }, ] },
  // 全作業 ⇔ 塗装: 下処理＆塗装＝塗装の下処理・下処理済P待ち・塗装を統合。Pのみ＝p_only。磨き・作業完了はそのまま。
  main: { id: 'main', title: '全工程', columns: [
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
  body: { id: 'body', title: '鈑金', columns: [ { id: 'b_wait', name: '鈑金 (Waiting)' }, { id: 'b_doing', name: '鈑金中' }, { id: 'b_done_p_wait', name: '鈑金完了 P待ち' }, { id: 'assembly', name: '組付け' }, { id: 'assembly_done_both', name: '組付完了 (磨無 & 磨完了)', statuses: ['completed', 'assembly_done_both'] }, { id: 'assembly_done_nuri', name: '組付完了 (磨無)', statuses: ['completed', 'assembly_done_nuri'] }, ] },
  paint: { id: 'paint', title: '塗装', columns: [ { id: 'prep', name: '下処理', statuses: ['prep', 'b_done_p_wait'] }, { id: 'prep_done', name: '下処理済 (P待ち)' }, { id: 'painting', name: '塗装' }, { id: 'assembly_wait', name: '組付け待ち' }, { id: 'polishing', name: '磨き' }, { id: 'polish_done', name: '磨き完了', statuses: ['completed', 'polish_done'] }, ] },
  delivery: { id: 'delivery', title: '納車管理', columns: [ { id: 'delivery_wait', name: '納車待ち' }, { id: 'delivery_today', name: '本日納車' }, { id: 'delivered_unpaid', name: '納車済み-支払い待ち' }, { id: 'delivered_paid', name: '納車済-支払い済み' }, { id: 'completed', name: '完了' }, ] },
  orphan: { id: 'orphan', title: '迷子', columns: [ { id: 'orphan', name: '迷子列' } ] }
};

// インドネシア語: ボード名・列名のみ（軽量表示切替用）
const LANG_KEY = 'brightboard_display_lang';
const BOARD_TITLES_ID = {
  planning: 'Reservasi Masuk (Perencanaan)',
  main: 'Manajemen Proses (Semua Pekerjaan)',
  body: 'Manajemen Body (Bodyshop)',
  paint: 'Manajemen Cat (Paint)',
  delivery: 'Manajemen Pengiriman',
  orphan: 'Papan Kartu Tersesat'
};
const COLUMN_NAMES_ID = {
  unscheduled: 'Belum Dijadwalkan',
  mon: 'Sen', tue: 'Sel', wed: 'Rab', thu: 'Kam', fri: 'Jum', sat: 'Sab', sun: 'Min',
  received: 'Sudah Masuk',
  b_wait: 'Menunggu B',
  b_doing: 'Proses B',
  b_done_p_wait: 'B Selesai, Menunggu P',
  p_only: 'P Saja',
  prep_paint: 'Persiapan & Cat',
  assembly: 'Perakitan',
  polish: 'Poles',
  polishing: 'Poles',
  completed: 'Pekerjaan Selesai',
  delivery_today: 'Kirim Hari Ini',
  delivery_wait: 'Menunggu Pengiriman',
  delivered_unpaid: 'Sudah Kirim - Menunggu Bayar',
  delivered_paid: 'Sudah Kirim - Sudah Bayar',
  prep: 'Persiapan',
  prep_done: 'Persiapan Selesai (Menunggu P)',
  painting: 'Cat',
  assembly_wait: 'Menunggu Perakitan',
  polish_done: 'Poles Selesai',
  assembly_done_both: 'Perakitan Selesai (Tanpa Poles & Selesai)',
  assembly_done_nuri: 'Perakitan Selesai (Tanpa Poles)',
  orphan: 'Kolom Tersesat'
};
function getBoardTitle(boardId, useId) {
  if (!useId || !boardId) return (BOARDS[boardId] && BOARDS[boardId].title) || boardId;
  return BOARD_TITLES_ID[boardId] || (BOARDS[boardId] && BOARDS[boardId].title) || boardId;
}
function getColumnName(col, useId) {
  if (!col) return '';
  if (!useId) return col.name || col.id || '';
  return COLUMN_NAMES_ID[col.id] || col.name || col.id || '';
}

const LINK_CONFIG_KEY = 'brightboard_column_statuses';
const CALENDAR_PENDING_KEY = 'brightboard_calendar_pending';
const NFC_PENDING_KEY = 'brightboard_nfc_task_id';
const COLUMN_WIDTH_KEY = 'brightboard_column_width';
const BOARD_COLUMNS_KEY = 'brightboard_board_columns';
const STAFF_OPTIONS_KEY = 'brightboard_staff_options';
const TASKS_CACHE_KEY = 'brightboard_tasks';
const RESERVATIONS_CACHE_KEY = 'brightboard_reservations';
const FLEET_CARS_KEY = 'brightboard_fleet_cars';

// --- スプレッドシート連携（1つのGAS URLで入庫記録・サイクルタイム両方を処理） ---
const SHEET_SYNC_URL = import.meta.env.VITE_SHEET_SYNC_URL;
const CYCLETIME_SHEET_URL = import.meta.env.VITE_CYCLETIME_SHEET_URL;

async function postToSheet(url, task, action) {
  if (!url) return;
  try {
    // GAS Web Appへの POST は Content-Type を text/plain にする
    // （application/json だと CORS preflight が発生して GAS がブロックする）
    await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ ...task, _action: action })
    });
  } catch (_) {
    // シート連携は補助的なため、失敗してもアプリ全体には影響させない
  }
}

// 入庫記録: カードが「入庫済み」に到達した時にPOST
async function syncCardToSheet(task) {
  postToSheet(SHEET_SYNC_URL, task, 'checkin');
}

const shouldSyncToSheetOnStatusChange = (prevStatus, nextStatus) => {
  if (!SHEET_SYNC_URL) return false;
  if (!nextStatus) return false;
  return prevStatus !== 'received' && nextStatus === 'received';
};

// サイクルタイム記録 + 納車記録: カードが「納車済み」に到達した時にPOST
const CYCLETIME_TRIGGER_STATUSES = new Set(['delivered_unpaid', 'delivered_paid']);

async function syncCycleTimeToSheet(task) {
  const url = CYCLETIME_SHEET_URL || SHEET_SYNC_URL;
  postToSheet(url, task, 'cycletime');
  // 納車記録も同時にPOST
  postToSheet(SHEET_SYNC_URL, task, 'delivery');
}

const shouldSyncCycleTime = (prevStatus, nextStatus) => {
  if (!CYCLETIME_SHEET_URL) return false;
  if (!nextStatus) return false;
  // 「納車済み-支払い待ち」または「納車済-支払い済み」に到達したタイミングで出力
  return !CYCLETIME_TRIGGER_STATUSES.has(prevStatus) && CYCLETIME_TRIGGER_STATUSES.has(nextStatus);
};

// ステータス変更時の共通ロガー
// prevStatus → newStatus への移動と、そのときの操作ユーザー（表示名）を履歴に残す
function transitionTaskStatusWithOperator(task, newStatus, extra = {}, operatorName = null) {
  const nowIso = new Date().toISOString();
  const prevStatus = task.status;
  const prevEnteredAt = task.statusEnteredAt || nowIso;
  let history = Array.isArray(task.statusHistory) ? [...task.statusHistory] : [];

  if (prevStatus) {
    const entry = {
      status: prevStatus,
      enteredAt: prevEnteredAt,
      exitedAt: nowIso,
      nextStatus: newStatus
    };
    if (operatorName) entry.byUser = operatorName;
    history = [...history, entry];
  }

  // 内部用メタデータはフィールドに残さない
  const { _operatorName, _operatorReason, ...restExtra } = extra || {};

  return {
    ...task,
    ...restExtra,
    status: newStatus,
    statusEnteredAt: nowIso,
    statusHistory: history
  };
}

function getStaffOptionsConfig() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STAFF_OPTIONS_KEY) : null;
    if (!raw) return { reception: [...RECEPTION_STAFF_OPTIONS], body: [...BODY_STAFF_OPTIONS], paint: [...PAINT_STAFF_OPTIONS] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { reception: [...RECEPTION_STAFF_OPTIONS], body: [...BODY_STAFF_OPTIONS], paint: [...PAINT_STAFF_OPTIONS] };
    const receptionRaw = Array.isArray(parsed.reception) ? parsed.reception.filter(s => typeof s === 'string') : [];
    return {
      reception: ensureReceptionStaffBase(receptionRaw),
      body: Array.isArray(parsed.body) ? parsed.body.filter(s => typeof s === 'string') : [...BODY_STAFF_OPTIONS],
      paint: Array.isArray(parsed.paint) ? parsed.paint.filter(s => typeof s === 'string') : [...PAINT_STAFF_OPTIONS]
    };
  } catch (_) {
    return { reception: [...RECEPTION_STAFF_OPTIONS], body: [...BODY_STAFF_OPTIONS], paint: [...PAINT_STAFF_OPTIONS] };
  }
}

function getStaffOptionsWithCurrentUser(currentUser, config, type) {
  const list = (config[type] || []);
  const base = Array.isArray(list) ? list : [];
  // 受付担当者: ログインユーザーは表示しない。米田・鶴田・あすか・佃の4名を常に表示
  if (type === 'reception') return base.filter(Boolean);
  const withCurrent = currentUser ? [currentUser, ...base] : base;
  return [...new Set(withCurrent)].filter(Boolean);
}

const DEFAULT_COLUMN_WIDTH = { desktop: 220, tablet: 180, mobile: 150 };
const BREAKPOINTS = { mobile: 768, tablet: 1024 }; // 未満=スマホ, 以上〜未満=タブレット, 以上=パソコン

function getColumnWidthConfig() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(COLUMN_WIDTH_KEY) : null;
    if (!raw) return { ...DEFAULT_COLUMN_WIDTH };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_COLUMN_WIDTH };
    return {
      desktop: typeof parsed.desktop === 'number' && parsed.desktop >= 80 ? parsed.desktop : DEFAULT_COLUMN_WIDTH.desktop,
      tablet: typeof parsed.tablet === 'number' && parsed.tablet >= 80 ? parsed.tablet : DEFAULT_COLUMN_WIDTH.tablet,
      mobile: typeof parsed.mobile === 'number' && parsed.mobile >= 80 ? parsed.mobile : DEFAULT_COLUMN_WIDTH.mobile
    };
  } catch (_) {
    return { ...DEFAULT_COLUMN_WIDTH };
  }
}

function getColumnMinWidthByViewport(config) {
  if (typeof window === 'undefined') return config.desktop;
  const w = window.innerWidth;
  if (w < BREAKPOINTS.mobile) return config.mobile;
  if (w < BREAKPOINTS.tablet) return config.tablet;
  return config.desktop;
}

function getBoardColumnsConfig() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BOARD_COLUMNS_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    Object.keys(parsed).forEach(bid => {
      if (!BOARDS[bid] || !Array.isArray(parsed[bid])) return;
      out[bid] = parsed[bid].filter(c => c && typeof c.id === 'string' && typeof c.name === 'string').map(c => ({
        id: c.id,
        name: c.name,
        statuses: Array.isArray(c.statuses) ? c.statuses : undefined
      }));
    });
    return out;
  } catch (_) {
    return {};
  }
}

function getColumnsForBoard(boardColumnsConfig, boardId) {
  const custom = boardColumnsConfig[boardId];
  if (custom && custom.length > 0) return custom;
  const board = BOARDS[boardId];
  return board && Array.isArray(board.columns) ? board.columns.map(c => ({ ...c })) : [];
}

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
// 初期表示用のダミーデータ（Firestore 未使用時または初期投入用）
const INITIAL_TASKS = [
  {
    id: 't1', status: 'received', color: 'bg-white',
    car: 'レクサス', number: '501', colorNo: '', assignee: 'T 個人 杉村',
    entryPrimary: '個人', entryDetail: '',
    inDate: '2026-02-11', outDate: '', loanerType: 'none', dots: ['red', 'white', 'white', 'white'],
    characters: ['car', 'paint'], tasks: ['check'],
    statusEnteredAt: new Date().toISOString(),
    statusHistory: []
  },
  {
    id: 't2', status: 'received', color: 'bg-blue-400',
    car: 'ワゴンR', number: 'R223', colorNo: '', assignee: 'あ 下田',
    entryPrimary: '個人', entryDetail: '',
    inDate: '2026-02-18', outDate: '2026-02-19', loanerType: 'loaner_k', dots: ['blue', 'blue', 'blue', 'blue'],
    characters: ['car'], tasks: [],
    statusEnteredAt: new Date().toISOString(),
    statusHistory: []
  },
  {
    id: 't3', status: 'b_wait', color: 'bg-yellow-300',
    car: 'ラパン', number: '853', colorNo: '', assignee: '米 T 松永',
    entryPrimary: '個人', entryDetail: '',
    inDate: '2026-02-27', outDate: '', loanerType: 'loaner_k', dots: ['yellow', 'yellow', 'white', 'white'],
    characters: ['wrench'], tasks: ['file'],
    statusEnteredAt: new Date().toISOString(),
    statusHistory: []
  },
  {
    id: 't4', status: 'b_doing', color: 'bg-white',
    car: 'ノート', number: '2554', colorNo: '', assignee: 'あ 南',
    entryPrimary: '個人', entryDetail: '',
    inDate: '2026-02-14', outDate: '2026-02-15', loanerType: 'rental', dots: ['red', 'yellow', 'white', 'white'],
    characters: [], tasks: ['settings'],
    statusEnteredAt: new Date().toISOString(),
    statusHistory: []
  },
  {
    id: 't5', status: 'prep_p', color: 'bg-blue-400',
    car: 'ムーブ', number: '3824', colorNo: '', assignee: 'T ソニー 富田',
    entryPrimary: '個人', entryDetail: '',
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

// --- ログイン画面（Firebase Google 認証）---
function LoginScreen({ authError, isLoading, onSignIn }) {
  const [localError, setLocalError] = useState('');
  const handleClick = async () => {
    setLocalError('');
    if (typeof onSignIn !== 'function') return;
    try {
      await onSignIn();
    } catch (err) {
      const msg = (err && err.message) || 'ログインに失敗しました。';
      const code = err && err.code;
      if (code === 'auth/popup-closed-by-user') setLocalError('');
      else if (code === 'auth/popup-blocked') setLocalError('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。');
      else setLocalError(msg);
    }
  };
  const errorMsg = authError || localError;
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-8 rounded shadow-sm border border-gray-200">
        <h1 className="text-2xl font-bold text-center mb-6 text-gray-800">ログイン</h1>
        <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-6 flex items-start gap-3">
          <AlertTriangle className="text-orange-500 w-5 h-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-700">このページにアクセスするにはGoogleアカウントでログインしてください。</p>
        </div>
        {errorMsg && (
          <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{errorMsg}</div>
        )}
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleClick}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 rounded px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            {isLoading ? 'ログイン中...' : 'Googleでログイン'}
          </button>
        </div>
      </div>
    </div>
  );
}

const FLEET_TYPE_OPTIONS = ['軽自動車', '普通車', 'レンタカー'];

// --- 代車ガントチャートコンポーネント ---
function LoanerGanttChart({ fleetCars, setFleetCars, reservations, setReservations, onReservationUpdate, setTasks, tasks = [], rentalCompanies = [], onSelectTask, viewOnly = false }) {
  const [listFilterType, setListFilterType] = useState('all');
  const [listGroupBy, setListGroupBy] = useState('none');
  const [draggedRes, setDraggedRes] = useState(null);
  const [resizingResId, setResizingResId] = useState(null);
  const [newCarName, setNewCarName] = useState('');
  const [newCarType, setNewCarType] = useState('軽自動車');
  const [isScheduleExpanded, setIsScheduleExpanded] = useState(true);
  const [isListExpanded, setIsListExpanded] = useState(false);
  const [viewOffsetDays, setViewOffsetDays] = useState(0); // 0=今日付近、正=先の日付へ
  const resizeDataRef = useRef({ res: null, timelineRect: null });

  const today = new Date();
  const handleAddCar = async () => {
    if (!newCarName.trim()) return;
    const id = `f${Date.now()}`;
    const car = { id, name: newCarName.trim(), type: newCarType, status: 'active', inspectionExpiry: '' };
    setFleetCars(prev => [...prev, car]);
    try {
      // Firestore 上のコレクションは 'fleetCars' に統一する（collection パスはスラッシュを含まない必要がある）
      await upsertDocument('fleetCars', id, car);
    } catch (_) {}
    setNewCarName('');
  };
  const daysRange = 14; // 2週間分表示
  const viewStartOffset = -3; // 表示開始を今日の3日前から
  const dates = Array.from({ length: daysRange }).map((_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + viewStartOffset + viewOffsetDays + i);
    return d;
  });

  const startDateStr = dates[0].toISOString().split('T')[0];

  const goToToday = () => setViewOffsetDays(0);
  const goPrev = () => setViewOffsetDays((prev) => Math.max(-60, prev - 7)); // 過去2ヶ月まで
  const goNext = () => setViewOffsetDays((prev) => Math.min(60, prev + 7)); // 未来2ヶ月まで

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
    if (viewOnly) return;
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
    if (viewOnly || !draggedRes) return;

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
    <div className="flex flex-col h-full bg-white overflow-y-auto">
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
      </div>

      <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50">
        <div className="px-6 py-3 flex items-center gap-3">
          <button type="button" onClick={() => setIsScheduleExpanded(!isScheduleExpanded)} className="flex items-center gap-2 text-left hover:bg-gray-100 transition-colors rounded py-1 px-1 -my-1 -mx-1">
            <ChevronRight className={`w-5 h-5 text-gray-500 flex-shrink-0 transition-transform ${isScheduleExpanded ? 'rotate-90' : ''}`} />
            <span className="font-semibold text-gray-700">貸出日程</span>
            {!isScheduleExpanded && <span className="text-sm text-gray-500">（クリックで展開）</span>}
          </button>
          <div className="flex items-center gap-1 ml-1">
            <button type="button" onClick={goPrev} className="p-2 rounded-md hover:bg-gray-200 text-gray-600 hover:text-gray-800 transition-colors" title="前の週">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button type="button" onClick={goNext} className="p-2 rounded-md hover:bg-gray-200 text-gray-600 hover:text-gray-800 transition-colors" title="次の週">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <button type="button" onClick={goToToday} className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors" title="今日の週を表示">
            今日
          </button>
          <button type="button" onClick={() => window.location.reload()} className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors" title="画面を再読み込み">
            更新
          </button>
        </div>
      </div>

      {isScheduleExpanded && (
      <div className="flex-1 overflow-auto p-4 min-h-0">
        <div className="inline-block min-w-max border border-gray-200 rounded shadow-sm bg-white">
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
                onDragOver={(e) => { e.preventDefault(); if (!viewOnly) e.dataTransfer.dropEffect = 'move'; }}
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
                        draggable={!viewOnly}
                        onDragStart={(e) => handleDragStart(e, res)}
                        onDragEnd={() => setDraggedRes(null)}
                        className={`flex-1 min-w-0 rounded-l-md shadow-sm flex items-center px-2 text-xs font-semibold truncate border border-black/10 rounded-r-none ${res.color} ${draggedRes?.id === res.id ? 'opacity-50' : 'hover:brightness-95'} ${viewOnly ? '' : 'cursor-grab active:cursor-grabbing'}`}
                        title={`${res.taskName} (${res.start} ~ ${res.end})`}
                      >
                        {res.taskName}
                      </div>
                      {!viewOnly && (
                      <div
                        role="button"
                        tabIndex={0}
                        className={`w-2 flex-shrink-0 rounded-r-md border border-black/10 border-l-0 cursor-ew-resize bg-black/10 hover:bg-blue-400/30 ${res.color} ${resizingResId === res.id ? 'ring-1 ring-blue-500' : ''}`}
                        title="右にドラッグで期間を延長"
                        onMouseDown={(e) => handleResizeStart(e, res)}
                        onDragStart={(e) => e.preventDefault()}
                      />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* --- 代車利用一覧（フィルタ・ソート・グループ化） --- */}
      <div className="border-t border-gray-200 bg-white">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <button type="button" onClick={() => setIsListExpanded(!isListExpanded)} className="flex items-start gap-2 text-left hover:bg-gray-100 transition-colors rounded py-1 px-1 -my-1 -mx-1">
              <ChevronRight className={`w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5 transition-transform ${isListExpanded ? 'rotate-90' : ''}`} />
              <div>
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <Truck className="w-5 h-5 text-blue-600" />
                  代車利用一覧
                  {!isListExpanded && <span className="text-xs font-normal text-gray-500">（クリックで展開）</span>}
                </h2>
                {isListExpanded && (
                  <p className="text-xs text-gray-500 mt-1">
                    貸出日数の降順で並びます。超過は赤、10日以上は 📌 でピン留めされます。
                  </p>
                )}
              </div>
            </button>
            {isListExpanded && (
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <span className="text-gray-500">種別</span>
                <select
                  className="border border-gray-300 rounded px-2 py-1 bg-white"
                  value={listFilterType}
                  onChange={(e) => setListFilterType(e.target.value)}
                >
                  <option value="all">すべて</option>
                  <option value="own">代（自社代車）</option>
                  <option value="rental">レ（自社レンタカー）</option>
                  <option value="other_rental">他（他社レンタカー）</option>
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-gray-500">グループ化</span>
                <select
                  className="border border-gray-300 rounded px-2 py-1 bg-white"
                  value={listGroupBy}
                  onChange={(e) => setListGroupBy(e.target.value)}
                >
                  <option value="none">なし</option>
                  <option value="type">代車種別</option>
                  <option value="company">レンタル会社</option>
                </select>
              </label>
            </div>
            )}
          </div>
          {isListExpanded && (() => {
            const typeCategory = (t) => (t.loanerType === 'other_rental' ? 'other_rental' : t.loanerType === 'rental' ? 'rental' : 'own');
            const typeLabel = { own: '代（自社代車）', rental: 'レ（自社レンタカー）', other_rental: '他（他社レンタカー）' };
            const carName = (t) => {
              if (t.loanerType === 'other_rental') return t.otherRentalName || '(会社名未設定)';
              const fc = fleetCars.find(f => f.id === t.loanerCarId);
              return fc ? fc.name : '(車両未選択)';
            };
            const filtered = (tasks || [])
              .filter(t => t && t.loanerType && t.loanerType !== 'none')
              .filter(t => listFilterType === 'all' ? true : typeCategory(t) === listFilterType)
              .map(t => ({ task: t, info: computeLoanerDayInfo(t) }))
              .sort((a, b) => {
                const ad = a.info?.elapsedDays ?? -1;
                const bd = b.info?.elapsedDays ?? -1;
                return bd - ad;
              });

            if (filtered.length === 0) {
              return <div className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded">該当する貸出はありません。</div>;
            }

            const groupKey = (row) => {
              if (listGroupBy === 'type') return typeLabel[typeCategory(row.task)] || 'その他';
              if (listGroupBy === 'company') {
                if (row.task.loanerType === 'other_rental') return row.task.otherRentalName || '(会社名未設定)';
                if (row.task.loanerType === 'rental') return '自社レンタカー';
                return '自社代車';
              }
              return '_all';
            };
            const groups = new Map();
            filtered.forEach(row => {
              const k = groupKey(row);
              if (!groups.has(k)) groups.set(k, []);
              groups.get(k).push(row);
            });

            const renderRow = ({ task: t, info }) => {
              const cat = typeCategory(t);
              const letter = cat === 'other_rental' ? '他' : cat === 'rental' ? 'レ' : '代';
              const badgeColor = info?.isOverrun ? 'bg-red-100 text-red-800 ring-1 ring-red-400' : cat === 'other_rental' ? 'bg-orange-100 text-orange-800' : cat === 'rental' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800';
              const dayText = info?.elapsedDays
                ? (info.plannedDays ? `${info.elapsedDays}/${info.plannedDays}日` : `${info.elapsedDays}日目`)
                : '—';
              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTask && onSelectTask(t.id)}
                  className={`flex items-center gap-3 px-3 py-2 text-sm border border-gray-100 rounded hover:bg-gray-50 cursor-pointer ${info?.isLongTerm ? 'bg-amber-50/40' : ''}`}
                >
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold ${badgeColor}`}>
                    <Truck className="w-3 h-3" /> {letter}
                  </span>
                  <span className={`text-xs font-medium min-w-[70px] ${info?.isOverrun ? 'text-red-700' : 'text-gray-700'}`}>
                    {dayText}{info?.isLongTerm ? ' 📌' : ''}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-gray-800">
                    {(t.assignee || '').trim()} <span className="text-gray-500">{t.car} {t.number}</span>
                  </span>
                  <span className="text-xs text-gray-500 truncate max-w-[180px]">{carName(t)}</span>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">{formatInOutDate(t.inDate, t.outDate)}</span>
                </div>
              );
            };

            if (listGroupBy === 'none') {
              return <div className="space-y-1">{filtered.map(renderRow)}</div>;
            }
            return (
              <div className="space-y-4">
                {[...groups.entries()].map(([k, rows]) => (
                  <div key={k}>
                    <div className="text-xs font-semibold text-gray-600 mb-1 pl-1">{k} <span className="text-gray-400">（{rows.length}件）</span></div>
                    <div className="space-y-1">{rows.map(renderRow)}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// --- リンク設定パネル（ドラッグ＆ドロップで列同士をリンク）---
function LinkConfigPanel({ columnStatuses, setColumnStatuses, onBack, onSave }) {
  const [localStatuses, setLocalStatuses] = useState(() => {
    const base = buildInitialColumnStatuses();
    if (columnStatuses && typeof columnStatuses === 'object')
      Object.keys(columnStatuses).forEach(bid => {
        if (base[bid] && columnStatuses[bid] && typeof columnStatuses[bid] === 'object')
          Object.keys(columnStatuses[bid]).forEach(cid => {
            const arr = columnStatuses[bid][cid];
            if (Array.isArray(arr) && arr.length > 0) base[bid][cid] = arr;
          });
      });
    return base;
  });
  const [draggedLink, setDraggedLink] = useState(null);
  const [expandedBoards, setExpandedBoards] = useState(() => {
    const initial = {};
    BOARD_ORDER.forEach(bid => {
      initial[bid] = bid === 'main' || bid === 'body' || bid === 'paint';
    });
    return initial;
  });

  useEffect(() => {
    const base = buildInitialColumnStatuses();
    if (columnStatuses && typeof columnStatuses === 'object')
      Object.keys(columnStatuses).forEach(bid => {
        if (base[bid] && columnStatuses[bid] && typeof columnStatuses[bid] === 'object')
          Object.keys(columnStatuses[bid]).forEach(cid => {
            const arr = columnStatuses[bid][cid];
            if (Array.isArray(arr) && arr.length > 0) base[bid][cid] = arr;
          });
      });
    setLocalStatuses(base);
  }, [columnStatuses]);

  const getStatuses = (boardId, colId) => {
    const list = localStatuses?.[boardId]?.[colId];
    if (Array.isArray(list) && list.length) return list;
    const col = BOARDS[boardId]?.columns?.find(c => c.id === colId);
    const def = Array.isArray(col?.statuses) ? col.statuses : [colId];
    return def || [colId];
  };

  const getPrimary = (boardId, colId) => getStatuses(boardId, colId)[0] || colId;

  const addLink = (targetBoardId, targetColId, statusToAdd) => {
    setLocalStatuses(prev => {
      const board = prev[targetBoardId] || {};
      const fallback = BOARDS[targetBoardId]?.columns?.find(c => c.id === targetColId)?.statuses ?? [targetColId];
      const list = board[targetColId] && board[targetColId].length ? board[targetColId] : fallback;
      if (list.includes(statusToAdd)) return prev;
      return { ...prev, [targetBoardId]: { ...board, [targetColId]: [...list, statusToAdd] } };
    });
  };

  const removeLink = (boardId, colId, statusToRemove) => {
    setLocalStatuses(prev => {
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

  const resetToDefault = () => { if (window.confirm('リンクを初期状態に戻しますか？')) setLocalStatuses(buildInitialColumnStatuses()); };

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <button type="button" onClick={onBack} className="text-sm text-blue-600 hover:underline">← 設定に戻る</button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={resetToDefault} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100">デフォルトに戻す</button>
          {onSave && (
            <button type="button" onClick={() => onSave(localStatuses)} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 font-medium">
              保存
            </button>
          )}
        </div>
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
function FleetMasterPanel({ fleetCars, setFleetCars, reservations, setReservations, setTasks, onBack, onSaveFleet }) {
  const [fleetCarsLocal, setFleetCarsLocal] = useState(() => Array.isArray(fleetCars) ? fleetCars.map(c => ({ ...c })) : []);
  const [newCarName, setNewCarName] = useState('');
  const [newCarType, setNewCarType] = useState(FLEET_TYPE_OPTIONS[0]);
  const [editingCarId, setEditingCarId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [editingType, setEditingType] = useState(FLEET_TYPE_OPTIONS[0]);

  useEffect(() => {
    setFleetCarsLocal(Array.isArray(fleetCars) ? fleetCars.map(c => ({ ...c })) : []);
  }, [fleetCars]);

  const handleAdd = () => {
    if (!newCarName.trim()) return;
    const id = `f${Date.now()}`;
    const car = { id, name: newCarName.trim(), type: newCarType, status: 'active', inspectionExpiry: '' };
    setFleetCarsLocal(prev => [...prev, car]);
    setNewCarName('');
  };

  const handleRemove = (car) => {
    const hasRes = reservations.some(r => r.carId === car.id);
    if (hasRes && !window.confirm(`「${car.name}」に予約が入っています。削除すると保存時に予約も解除され、紐づくカードの代車情報もクリアされます。削除しますか？`)) return;
    setFleetCarsLocal(prev => prev.filter(c => c.id !== car.id));
  };

  const handleStatusChange = (carId, status) => {
    setFleetCarsLocal(prev => prev.map(c => c.id === carId ? { ...c, status } : c));
  };

  const handleExpiryChange = (carId, value) => {
    setFleetCarsLocal(prev => prev.map(c => c.id === carId ? { ...c, inspectionExpiry: value } : c));
  };

  const beginEdit = (car) => {
    setEditingCarId(car.id);
    setEditingName(car.name || '');
    setEditingType(car.type || FLEET_TYPE_OPTIONS[0]);
  };

  const cancelEdit = () => {
    setEditingCarId(null);
    setEditingName('');
    setEditingType(FLEET_TYPE_OPTIONS[0]);
  };

  const saveEdit = () => {
    if (!editingCarId) return;
    const trimmedName = editingName.trim();
    if (!trimmedName) return;
    setFleetCarsLocal(prev => prev.map(c => c.id === editingCarId ? { ...c, name: trimmedName, type: editingType } : c));
    cancelEdit();
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <button type="button" onClick={onBack} className="text-sm text-blue-600 hover:underline">← 設定に戻る</button>
        {onSaveFleet && (
          <button type="button" onClick={() => onSaveFleet(fleetCarsLocal)} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 font-medium">
            保存
          </button>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-4">
        代車・レンタカーの車両を追加・削除・ステータス変更できます。ここでの変更は代車ガントチャートとカード作成時の車両選択にも反映されます。
      </p>

      <div className="mb-6 space-y-2">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">車両の追加</div>
        <div className="flex flex-wrap items-center gap-2">
          <IMEInput
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-56"
            placeholder="車両名（例: N-BOX 熊本580あ1234）"
            value={newCarName}
            onChange={(v) => setNewCarName(v)}
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
          {fleetCarsLocal.map(car => (
            <div key={car.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {editingCarId === car.id ? (
                  <div className="space-y-1">
                    <IMEInput
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
                      value={editingName}
                      onChange={(v) => setEditingName(v)}
                    />
                    <select
                      className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                      value={editingType}
                      onChange={(e) => setEditingType(e.target.value)}
                    >
                      {FLEET_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <div className="flex gap-2 mt-1">
                      <button
                        type="button"
                        onClick={saveEdit}
                        className="px-2 py-0.5 rounded bg-blue-600 text-white text-[11px] hover:bg-blue-700"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="px-2 py-0.5 rounded border border-gray-300 text-[11px] text-gray-600 hover:bg-gray-50"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="text-sm font-medium text-gray-800 truncate" title={car.name}>{car.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{car.type}</div>
                  </>
                )}
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
                onClick={() => beginEdit(car)}
                className="ml-2 p-1 rounded text-gray-500 hover:text-blue-600 hover:bg-blue-50"
                title="編集"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleRemove(car)}
                className="text-xs text-red-600 hover:underline"
              >
                削除
              </button>
            </div>
          ))}
          {fleetCarsLocal.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">登録されている車両はありません。</div>
          )}
        </div>
      </div>
    </>
  );
}

// --- レンタル会社マスタ設定パネル ---
function RentalCompaniesMasterPanel({ rentalCompanies, onBack, onSave }) {
  const [companiesLocal, setCompaniesLocal] = useState(() => Array.isArray(rentalCompanies) ? rentalCompanies.map(c => ({ ...c })) : []);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  useEffect(() => {
    setCompaniesLocal(Array.isArray(rentalCompanies) ? rentalCompanies.map(c => ({ ...c })) : []);
  }, [rentalCompanies]);

  const handleAdd = () => {
    const name = (newName || '').trim();
    if (!name) return;
    const id = `rc_${Date.now()}`;
    setCompaniesLocal(prev => [...prev, { id, name, phone: (newPhone || '').trim() || null, isActive: true }]);
    setNewName('');
    setNewPhone('');
  };

  const handleRemove = (id) => {
    setCompaniesLocal(prev => prev.filter(c => c.id !== id));
  };

  const handleToggleActive = (id) => {
    setCompaniesLocal(prev => prev.map(c => c.id === id ? { ...c, isActive: !c.isActive } : c));
  };

  const handleRename = (id, name) => {
    setCompaniesLocal(prev => prev.map(c => c.id === id ? { ...c, name } : c));
  };

  const handlePhoneChange = (id, phone) => {
    setCompaniesLocal(prev => prev.map(c => c.id === id ? { ...c, phone: phone || null } : c));
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <button type="button" onClick={onBack} className="text-sm text-blue-600 hover:underline">← 設定に戻る</button>
        {onSave && (
          <button type="button" onClick={() => onSave(companiesLocal)} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 font-medium">
            保存
          </button>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-4">
        他社レンタカーの会社名マスタを管理します。ここで登録した会社はカード作成時のプルダウンに表示されます。
      </p>

      <div className="mb-6 space-y-2">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">会社の追加</div>
        <div className="flex flex-wrap items-center gap-2">
          <IMEInput
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-56"
            placeholder="会社名（例: オリックスレンタカー）"
            value={newName}
            onChange={(v) => setNewName(v)}
          />
          <IMEInput
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40"
            placeholder="電話番号（任意）"
            value={newPhone}
            onChange={(v) => setNewPhone(v)}
          />
          <button
            type="button"
            onClick={handleAdd}
            className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            会社を追加
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">登録済み会社</div>
        <div className="border border-gray-200 rounded-lg max-h-[340px] overflow-y-auto divide-y divide-gray-100">
          {companiesLocal.map(co => (
            <div key={co.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <IMEInput
                  className="border border-gray-200 rounded px-2 py-1 text-sm w-full max-w-[260px]"
                  value={co.name}
                  onChange={(v) => handleRename(co.id, v)}
                />
                <IMEInput
                  className="border border-gray-200 rounded px-2 py-1 text-xs w-full max-w-[180px]"
                  placeholder="電話番号（任意）"
                  value={co.phone || ''}
                  onChange={(v) => handlePhoneChange(co.id, v)}
                />
              </div>
              <label className="flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" checked={co.isActive !== false} onChange={() => handleToggleActive(co.id)} />
                稼働中
              </label>
              <button
                type="button"
                onClick={() => handleRemove(co.id)}
                className="text-xs text-red-600 hover:underline"
              >
                削除
              </button>
            </div>
          ))}
          {companiesLocal.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">登録されている会社はありません。</div>
          )}
        </div>
      </div>
    </>
  );
}

// --- ボード別・列の増減設定パネル ---
function ColumnEditPanel({ boardColumnsConfig, setBoardColumnsConfig, columnStatuses, setTasks, onBack }) {
  const [selectedBoardId, setSelectedBoardId] = useState(BOARD_ORDER[0]);
  const [newColumnName, setNewColumnName] = useState('');

  const getStatuses = (boardId, col) => {
    const custom = columnStatuses?.[boardId]?.[col.id];
    if (Array.isArray(custom) && custom.length) return custom;
    return Array.isArray(col.statuses) ? col.statuses : [col.id];
  };
  const getPrimary = (boardId, col) => getStatuses(boardId, col)[0] || col.id;

  const columns = getColumnsForBoard(boardColumnsConfig, selectedBoardId);

  const handleAddColumn = () => {
    const name = (newColumnName || '').trim() || '新規列';
    setNewColumnName('');
    const newCol = { id: `custom_${Date.now()}`, name };
    setBoardColumnsConfig(prev => ({
      ...prev,
      [selectedBoardId]: [...getColumnsForBoard(prev, selectedBoardId), newCol]
    }));
  };

  const handleRemoveColumn = (col) => {
    if (columns.length <= 1) {
      window.alert('列は1つ以上必要です。');
      return;
    }
    const statusesToRemove = getStatuses(selectedBoardId, col);
    // 削除対象列と同じ列を先頭にしないよう、削除対象以外の最初の列を移動先にする
    const remainingCols = columns.filter(c => c.id !== col.id);
    const targetCol = remainingCols[0];
    const primaryStatus = targetCol ? getPrimary(selectedBoardId, targetCol) : null;
    if (!primaryStatus) {
      window.alert('移動先の列が見つかりません。');
      return;
    }
    // このボードに固有のステータスのみ対象にし、他ボードと共有されたステータスのカードは巻き込まない
    const otherBoardStatuses = new Set();
    BOARD_ORDER.forEach(bid => {
      if (bid === selectedBoardId || bid === 'orphan') return;
      const board = BOARDS[bid];
      if (!board || !Array.isArray(board.columns)) return;
      board.columns.forEach(c => {
        const sts = Array.isArray(c.statuses) ? c.statuses : [c.id];
        sts.forEach(s => otherBoardStatuses.add(s));
      });
    });
    const safeStatusesToRemove = statusesToRemove.filter(s => !otherBoardStatuses.has(s));
    if (safeStatusesToRemove.length === 0 && statusesToRemove.length > 0) {
      if (!window.confirm(`列「${col.name}」のステータスは他ボードと共有されています。\n列の表示は削除しますが、カードのステータスは変更しません。よろしいですか？`)) return;
      setBoardColumnsConfig(prev => ({
        ...prev,
        [selectedBoardId]: getColumnsForBoard(prev, selectedBoardId).filter(c => c.id !== col.id)
      }));
      return;
    }
    if (window.confirm(`列「${col.name}」を削除しますか？\nこの列にいるカードは「${targetCol?.name}」に移動されます。`)) {
      setTasks(prev => prev.map(t => {
        if (!safeStatusesToRemove.includes(t.status)) return t;
        const updated = { ...t, status: primaryStatus };
        // Firestoreにも反映して永続化する
        if (isFirebaseConfigured()) upsertDocument('boards/main/tasks', updated.id, updated).catch(() => {});
        return updated;
      }));
      setBoardColumnsConfig(prev => ({
        ...prev,
        [selectedBoardId]: getColumnsForBoard(prev, selectedBoardId).filter(c => c.id !== col.id)
      }));
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={onBack} className="text-sm text-blue-600 hover:underline">← 設定に戻る</button>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        各ボードの列を追加・削除できます。削除した列にあったカードは、先頭の列に移動されます。
      </p>
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">対象ボード</label>
        <select
          value={selectedBoardId}
          onChange={(e) => setSelectedBoardId(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
        >
          {BOARD_ORDER.map(bid => (
            <option key={bid} value={bid}>{BOARDS[bid]?.title ?? bid}</option>
          ))}
        </select>
      </div>
      <div className="mb-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">列の追加</div>
        <div className="flex gap-2">
          <IMEInput
            className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm"
            placeholder="列の名前（例: 検討中）"
            value={newColumnName}
            onChange={(v) => setNewColumnName(v)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddColumn())}
          />
          <button type="button" onClick={handleAddColumn} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 whitespace-nowrap">
            列を追加
          </button>
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">現在の列（{columns.length}件）</div>
        <div className="border border-gray-200 rounded-lg max-h-[280px] overflow-y-auto divide-y divide-gray-100">
          {columns.map((col, idx) => (
            <div key={col.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
              <span className="text-sm text-gray-800 truncate">{idx + 1}. {col.name}</span>
              <button
                type="button"
                onClick={() => handleRemoveColumn(col)}
                disabled={columns.length <= 1}
                className="text-xs text-red-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              >
                削除
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// --- 担当者一覧の編集パネル（受付・鈑金・塗装のプルダウン項目の増減）---
function StaffOptionsPanel({ staffOptionsConfig, setStaffOptionsConfig, onBack, onSave }) {
  const [localConfig, setLocalConfig] = useState(() => ({
    reception: Array.isArray(staffOptionsConfig?.reception) ? [...staffOptionsConfig.reception] : [],
    body: Array.isArray(staffOptionsConfig?.body) ? [...staffOptionsConfig.body] : [],
    paint: Array.isArray(staffOptionsConfig?.paint) ? [...staffOptionsConfig.paint] : [],
  }));
  const [newName, setNewName] = useState({ reception: '', body: '', paint: '' });
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    setLocalConfig({
      reception: Array.isArray(staffOptionsConfig?.reception) ? [...staffOptionsConfig.reception] : [],
      body: Array.isArray(staffOptionsConfig?.body) ? [...staffOptionsConfig.body] : [],
      paint: Array.isArray(staffOptionsConfig?.paint) ? [...staffOptionsConfig.paint] : [],
    });
  }, [staffOptionsConfig]);

  const handleAdd = (type) => {
    const name = (newName[type] || '').trim();
    if (!name) return;
    setLocalConfig(prev => ({
      ...prev,
      [type]: [...(prev[type] || []), name]
    }));
    setNewName(prev => ({ ...prev, [type]: '' }));
  };

  const handleRemove = (type, index) => {
    setLocalConfig(prev => {
      const list = prev[type] || [];
      const name = list[index];
      // 受付担当者の4名（米田・鶴田・あすか・佃）は削除不可
      if (type === 'reception' && name && RECEPTION_STAFF_OPTIONS.includes(name)) return prev;
      return {
        ...prev,
        [type]: list.filter((_, i) => i !== index)
      };
    });
  };

  const labels = { reception: '受付担当者', body: '鈑金担当者', paint: '塗装担当者' };
  const types = ['reception', 'body', 'paint'];

  return (
    <>
      {saveMessage && (
        <div className="mb-3 px-3 py-2 rounded bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {saveMessage}
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={onBack} className="text-sm text-blue-600 hover:underline">← 設定に戻る</button>
        {onSave && (
          <button
            type="button"
            onClick={() => {
              onSave(localConfig);
              setSaveMessage('担当者マスタを保存しました。');
              setTimeout(() => setSaveMessage(''), 3000);
            }}
            className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 font-medium"
          >
            保存
          </button>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-4">
        カード作成・カード詳細の「受付担当者」「鈑金担当者」「塗装担当者」のプルダウンに表示する項目を追加・削除できます。受付担当者の「米田・鶴田・あすか・佃」は常に表示され、削除できません。
      </p>
      <div className="space-y-6">
        {types.map(type => (
          <div key={type} className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{labels[type]}</h3>
            <div className="flex gap-2 mb-2">
              <IMEInput
                className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm"
                placeholder="名前を入力して追加"
                value={newName[type] || ''}
                onChange={(v) => setNewName(prev => ({ ...prev, [type]: v }))}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAdd(type))}
              />
              <button type="button" onClick={() => handleAdd(type)} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 whitespace-nowrap">追加</button>
            </div>
            <ul className="space-y-1 max-h-32 overflow-y-auto">
              {(localConfig[type] || []).map((name, idx) => (
                <li key={`${type}-${idx}`} className="flex items-center justify-between gap-2 py-1">
                  <span className="text-sm text-gray-800">{name}</span>
                  <button type="button" onClick={() => handleRemove(type, idx)} className="text-xs text-red-600 hover:underline">削除</button>
                </li>
              ))}
              {(localConfig[type] || []).length === 0 && <li className="text-sm text-gray-400 py-2">項目がありません。上で追加してください。</li>}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}

// --- カレンダーイベント作成モーダル（ログイン中のGoogleカレンダーに入庫予約イベントを作成）---
function CalendarLinkModal({ onClose }) {
  const [assignee, setAssignee] = useState('');
  const [car, setCar] = useState('');
  const [number, setNumber] = useState('');
  const [inDate, setInDate] = useState(getTodayString());
  const [inTime, setInTime] = useState('09:00');
  const [imageUrl, setImageUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const createBrightBoardUrl = () => {
    const params = new URLSearchParams({
      fromCalendar: '1',
      assignee: assignee || '（顧客名）',
      car: car || '（車種）',
      number: number || '（ナンバー）',
      inDate: inDate || getTodayString(),
      inTime: inTime || '09:00'
    });
    if (imageUrl && imageUrl.trim()) params.set('imageUrl', imageUrl.trim());
    return `${typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''}?${params.toString()}`;
  };

  const handleCreateCalendarEvent = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || !clientId.trim()) {
      setErrorMessage('Googleカレンダー連携の設定が必要です。.env に VITE_GOOGLE_CLIENT_ID を設定してください。');
      return;
    }
    // GISスクリプトが未ロードなら動的に読み込む（index.htmlから削除済み：ページ読み込み時のキーボード入力ブロック防止）
    if (typeof window !== 'undefined' && (!window.google || !window.google.accounts || !window.google.accounts.oauth2)) {
      try {
        await new Promise((resolve, reject) => {
          if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
            // スクリプトタグは存在するがまだロード完了していない場合
            const check = setInterval(() => {
              if (window.google && window.google.accounts && window.google.accounts.oauth2) { clearInterval(check); resolve(); }
            }, 200);
            setTimeout(() => { clearInterval(check); reject(new Error('timeout')); }, 10000);
          } else {
            const s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client';
            s.onload = () => {
              const check = setInterval(() => {
                if (window.google && window.google.accounts && window.google.accounts.oauth2) { clearInterval(check); resolve(); }
              }, 200);
              setTimeout(() => { clearInterval(check); reject(new Error('timeout')); }, 10000);
            };
            s.onerror = () => reject(new Error('スクリプトの読み込みに失敗しました'));
            document.head.appendChild(s);
          }
        });
      } catch {
        setErrorMessage('Googleサインインの読み込みに失敗しました。ページを再読み込みしてください。');
        return;
      }
    }
    setIsCreating(true);
    try {
      const token = await new Promise((resolve, reject) => {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/calendar.events',
          callback: (response) => {
            if (response && response.access_token) resolve(response.access_token);
            else reject(new Error('トークンを取得できませんでした'));
          }
        });
        client.requestAccessToken();
      });
      const dateStr = inDate || getTodayString();
      const [hours, minutes] = (inTime || '09:00').split(':').map((n) => parseInt(n, 10) || 0);
      const pad = (n) => String(n).padStart(2, '0');
      const startDateTime = `${dateStr}T${pad(hours)}:${pad(minutes)}:00+09:00`;
      let endDateStr = dateStr;
      let endH = hours + 1;
      if (endH >= 24) {
        endH -= 24;
        const d = new Date(dateStr + 'T12:00:00+09:00');
        d.setDate(d.getDate() + 1);
        endDateStr = d.toISOString().slice(0, 10);
      }
      const endDateTime = `${endDateStr}T${pad(endH)}:${pad(minutes)}:00+09:00`;
      const descLines = [
        `顧客名: ${assignee || '（未入力）'}`,
        `車種: ${car || '（未入力）'}`,
        `ナンバー: ${number || '（未入力）'}`,
        `入庫日: ${dateStr}`,
        `入庫時刻: ${inTime || '09:00'}`
      ];
      if (imageUrl && imageUrl.trim()) descLines.push(`画像URL: ${imageUrl.trim()}`);
      descLines.push('', 'BrightBoardでこの内容のカードを作成:', createBrightBoardUrl());
      const event = {
        summary: `入庫予約 - ${assignee || '（顧客名）'} ${car || '（車種）'} ${number || '（ナンバー）'}`.trim(),
        description: descLines.join('\n'),
        start: { dateTime: startDateTime, timeZone: 'Asia/Tokyo' },
        end: { dateTime: endDateTime, timeZone: 'Asia/Tokyo' }
      };
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      });
      if (!res.ok) {
        const errBody = await res.text();
        let msg = `カレンダーに追加できませんでした（${res.status}）`;
        try {
          const j = JSON.parse(errBody);
          if (j.error && j.error.message) msg = j.error.message;
        } catch (_) {}
        setErrorMessage(msg);
        return;
      }
      setSuccessMessage('Googleカレンダーにイベントを作成しました。');
      setTimeout(() => { setSuccessMessage(''); onClose(); }, 2500);
    } catch (err) {
      setErrorMessage(err && err.message ? err.message : 'イベントの作成に失敗しました。');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end p-0 pointer-events-none">
      <div className="w-0 flex-1 min-w-0" aria-hidden />
      <div className="bg-white rounded-l-lg shadow-xl w-full max-w-md pointer-events-auto flex flex-col max-h-full overflow-y-auto border-l border-gray-200">
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            Googleカレンダーにイベントを作成
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-4 space-y-4 text-sm">
          <p className="text-gray-600">
            入庫予定の内容を入力し、ボタンを押すとログイン中のGoogleアカウントのカレンダーに、入力内容が反映されたイベントが1件作成されます。説明欄にBrightBoardでカードを作成するリンクも含まれます。
          </p>
          {errorMessage && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{errorMessage}</div>}
          {successMessage && <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">{successMessage}</div>}
          <div>
            <label className="block text-gray-700 font-medium mb-1">お客様名</label>
            <IMEInput className="w-full border border-gray-300 rounded px-3 py-2" placeholder="例: 山田 太郎" value={assignee} onChange={(v) => setAssignee(v)} />
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-1">車種</label>
            <IMEInput className="w-full border border-gray-300 rounded px-3 py-2" placeholder="例: ノート" value={car} onChange={(v) => setCar(v)} />
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-1">ナンバー</label>
            <IMEInput className="w-full border border-gray-300 rounded px-3 py-2" placeholder="例: 熊本500あ1234" value={number} onChange={(v) => setNumber(v)} />
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
            <label className="block text-gray-700 font-medium mb-1">画像URL（イベント説明・BrightBoardカード添付用）</label>
            <input type="url" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" placeholder="例: https://..." value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={handleCreateCalendarEvent} disabled={isCreating} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed">
              <Calendar className="w-4 h-4" />
              {isCreating ? '作成中...' : 'Googleカレンダーにイベントを作成'}
            </button>
            <button type="button" onClick={onClose} disabled={isCreating} className="px-4 py-3 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60">閉じる</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 通知を送るモーダル（目安箱：送り先を過去ログインユーザーから選んで送信）---
function SendNotificationModal({ onClose, currentUser = '', currentUserEmail = '', allowedEmails = [], pastLoginUsers = [] }) {
  const [toEmail, setToEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState(''); // 'success' | 'error' | ''
  const [errorDetail, setErrorDetail] = useState(''); // 送信失敗時の詳細（権限エラー等）

  // 送り先候補: 過去ログインユーザーと VITE_ALLOWED_EMAILS をマージ（重複はemailで除外、表示名は過去ログイン優先）
  const allowedList = (Array.isArray(allowedEmails) ? allowedEmails : []).map((email) => ({ email: email.toLowerCase(), displayName: email }));
  const byEmail = new Map();
  pastLoginUsers.forEach((u) => byEmail.set((u.email || '').toLowerCase(), u));
  allowedList.forEach((u) => { if (!byEmail.has(u.email)) byEmail.set(u.email, u); });
  const recipientOptions = Array.from(byEmail.values()).filter((u) => (u.email || '').trim());
  const TO_ALL_VALUE = '__all__'; // 送り先「すべてのログインユーザーに送る」のときの value

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = (message || '').trim();
    const target = (toEmail || '').trim();
    if (!text || !target) return;
    if (!isFirebaseConfigured()) {
      setStatus('error');
      setErrorDetail('VITE_FIREBASE_* の環境変数が設定されていません。');
      return;
    }
    setIsSending(true);
    setStatus('');
    setErrorDetail('');
    try {
      const fromUser = currentUser || '（未設定）';
      const fromEmail = (currentUserEmail || '').toLowerCase();
      const payload = { fromUser, fromEmail, message: text, createdAt: new Date().toISOString(), read: false };
      if (target === TO_ALL_VALUE) {
        for (const u of displayOptions) {
          const email = (u.email || '').toLowerCase();
          if (!email) continue;
          const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `n_${Date.now()}_${Math.random().toString(36).slice(2)}_${email.slice(0, 8)}`;
          await upsertDocument('notifications', id, { ...payload, toEmail: email });
        }
      } else {
        const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `n_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        await upsertDocument('notifications', id, { ...payload, toEmail: target.toLowerCase() });
      }
      setStatus('success');
      setMessage('');
      setToEmail('');
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setStatus('error');
      const msg = (err && err.message) ? String(err.message) : '';
      const hint = /permission|権限|forbidden/i.test(msg)
        ? 'Firestore の notifications コレクションで、認証済みユーザー（request.auth != null）の書き込みを許可するルールを追加してください。'
        : msg || 'Firebase の設定とネットワークを確認してください。';
      setErrorDetail(hint);
    } finally {
      setIsSending(false);
    }
  };

  const myEmail = (currentUserEmail || '').toLowerCase();
  const displayOptions = recipientOptions.filter((u) => (u.email || '').toLowerCase() !== myEmail);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Mailbox className="w-5 h-5 text-amber-600" />
            通知を送る（目安箱）
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <p className="text-sm text-gray-600">
            メールは送信されません。送り先のユーザーがアプリにログインしているとき、相手の画面右上のベルに赤いバッジが付き、ベルを開くと通知を読めます。
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">送り先</label>
            <select
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              required
            >
              <option value="">選択してください</option>
              {displayOptions.length > 0 && (
                <option value={TO_ALL_VALUE}>すべてのログインユーザーに送る（{displayOptions.length}人）</option>
              )}
              {displayOptions.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.displayName ? `${u.displayName}（${u.email}）` : u.email}
                </option>
              ))}
            </select>
            {displayOptions.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">送り先がありません。.env の VITE_ALLOWED_EMAILS にメールアドレスをカンマ区切りで設定するか、誰かがPCでこのアプリにGoogleログインすると送り先に表示されます。Firestore の users コレクションの読み取り権限もご確認ください。</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">内容</label>
            <IMETextarea
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm min-h-[100px] resize-y"
              placeholder="伝えたいことを入力..."
              value={message}
              onChange={(v) => setMessage(v)}
              disabled={isSending}
            />
          </div>
          {status === 'error' && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm space-y-1">
              <div>送信に失敗しました。</div>
              {errorDetail && <div className="text-xs mt-1">{errorDetail}</div>}
            </div>
          )}
          {status === 'success' && (
            <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">送信しました。</div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={isSending || !(message || '').trim() || !(toEmail || '').trim()} className="flex-1 px-4 py-3 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {isSending ? '送信中...' : '送信する'}
            </button>
            <button type="button" onClick={onClose} disabled={isSending} className="px-4 py-3 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">閉じる</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- 不具合通知モーダル（カード→目安箱DnDで起動） ---
// 既存の手動 SendNotificationModal とは独立。送信先はオーナー固定。
function IncidentReportModal({ task, onClose, onSent, currentUser = '', currentUserEmail = '', boardColumnsConfig = {}, useIndonesian = false }) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState(''); // 'success' | 'error' | ''
  const [errorDetail, setErrorDetail] = useState('');

  // status → ラベル解決（全ボードを横断して該当列を探す）
  const resolveStatusLabel = (statusId) => {
    if (!statusId) return '';
    for (const bid of Object.keys(boardColumnsConfig || {})) {
      const cols = getColumnsForBoard(boardColumnsConfig, bid) || [];
      for (const col of cols) {
        const sts = getColumnStatuses(col);
        if (Array.isArray(sts) && sts.includes(statusId)) {
          return getColumnName(col, useIndonesian);
        }
      }
    }
    return statusId;
  };

  const buildSnapshot = () => {
    if (!task) return null;
    const recent = Array.isArray(task.statusHistory) ? task.statusHistory.slice(-5) : [];
    return {
      taskId: task.id,
      assignee: task.assignee || '',
      maker: task.maker || '',
      car: task.car || '',
      number: task.number || '',
      status: task.status || '',
      statusLabel: resolveStatusLabel(task.status),
      statusEnteredAt: task.statusEnteredAt || null,
      receptionStaff: task.receptionStaff || '',
      bankinStaff: task.bankinStaff || task.bodyStaff || '',
      inDate: task.inDate || null,
      outDate: task.outDate || null,
      loanerType: task.loanerType || null,
      recentStatusHistory: recent.map((h) => ({
        status: h?.status || '',
        statusLabel: resolveStatusLabel(h?.status),
        enteredAt: h?.enteredAt || null,
        exitedAt: h?.exitedAt || null,
        nextStatus: h?.nextStatus || null,
        byUser: h?.byUser || null,
      })),
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = (message || '').trim();
    if (!text || !task) return;
    if (!isFirebaseConfigured()) {
      setStatus('error');
      setErrorDetail('VITE_FIREBASE_* の環境変数が設定されていません。');
      return;
    }
    setIsSending(true);
    setStatus('');
    setErrorDetail('');
    try {
      const fromUser = currentUser || '（未設定）';
      const fromEmail = (currentUserEmail || '').toLowerCase();
      const toEmail = getIncidentReportTo();
      const id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `n_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const payload = {
        kind: 'incident_report',
        fromUser,
        fromEmail,
        toEmail,
        message: text,
        cardSnapshot: buildSnapshot(),
        createdAt: new Date().toISOString(),
        read: false,
      };
      await upsertDocument('notifications', id, payload);
      // 秘書Bot Worker 経由で Discord 整形通知（fire-and-forget / 失敗してもユーザー操作は続行）
      const botUrl = import.meta.env.VITE_SECRETARY_BOT_URL;
      const botSecret = import.meta.env.VITE_SECRETARY_BOT_INCIDENT_SECRET;
      if (botUrl && botSecret) {
        fetch(`${botUrl.replace(/\/$/, '')}/incident/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Incident-Secret': botSecret },
          body: JSON.stringify({
            notificationId: id,
            fromUser: payload.fromUser,
            fromEmail: payload.fromEmail,
            message: payload.message,
            cardSnapshot: payload.cardSnapshot,
            createdAt: payload.createdAt,
          }),
        }).catch((e) => console.warn('[incident] Discord通知の送信に失敗（Firestore保存は成功）:', e));
      }
      setStatus('success');
      setMessage('');
      // 親コンポーネントへ通知 → トースト表示 → モーダル即閉じ
      if (typeof onSent === 'function') {
        const carLine = `${task.maker || ''} ${task.car || ''}`.trim();
        const numTail = (task.number || '').toString().slice(-4);
        onSent({ label: `${task.assignee || '（顧客名なし）'} / ${carLine}${numTail ? ` ${numTail}` : ''}` });
      }
      setTimeout(() => onClose(), 400);
    } catch (err) {
      setStatus('error');
      const msg = (err && err.message) ? String(err.message) : '';
      const hint = /permission|権限|forbidden/i.test(msg)
        ? 'Firestore の notifications コレクションで、認証済みユーザーの書き込みを許可するルールを確認してください。'
        : msg || 'Firebase の設定とネットワークを確認してください。';
      setErrorDetail(hint);
    } finally {
      setIsSending(false);
    }
  };

  if (!task) return null;
  const carLine = `${task.maker || ''} ${task.car || ''}`.trim();
  const statusLabel = resolveStatusLabel(task.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Mailbox className="w-5 h-5 text-amber-600" />
            不具合通知（目安箱）
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm space-y-1">
            <div className="font-semibold text-amber-900">対象カード</div>
            <div className="text-gray-800">
              <div><span className="text-gray-500 text-xs">お客様: </span>{task.assignee || '（未設定）'}</div>
              <div><span className="text-gray-500 text-xs">車両: </span>{carLine || '（未設定）'} {task.number || ''}</div>
              <div><span className="text-gray-500 text-xs">現ステータス: </span>{statusLabel || '（不明）'}</div>
              {task.receptionStaff && (
                <div><span className="text-gray-500 text-xs">受付: </span>{task.receptionStaff}</div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">症状・気づいたこと</label>
            <IMETextarea
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm min-h-[120px] resize-y"
              placeholder="例: 3日間ステータスが変わってない / 鍵がどこにあるか分からない / 部品取り寄せが止まってる気がする"
              value={message}
              onChange={(v) => setMessage(v)}
              disabled={isSending}
            />
            <p className="text-xs text-gray-500 mt-1">送信先: オーナー（清田）。原因調査の上、Discord でフィードバックされます。</p>
          </div>
          {status === 'error' && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm space-y-1">
              <div>送信に失敗しました。</div>
              {errorDetail && <div className="text-xs mt-1">{errorDetail}</div>}
            </div>
          )}
          {status === 'success' && (
            <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">送信しました。</div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={isSending || !(message || '').trim()} className="flex-1 px-4 py-3 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {isSending ? '送信中...' : '不具合を報告する'}
            </button>
            <button type="button" onClick={onClose} disabled={isSending} className="px-4 py-3 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">キャンセル</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- NFCタグ用: 列移動だけを行うシンプルな専用画面 ---
function NfcStandalonePage({ currentUser = 'ログインユーザー', onLogout, nfcTaskId: nfcTaskIdProp = null, nfcBinderNumber = null }) {
  const useIndonesian = (() => {
    try {
      if (typeof window === 'undefined') return false;
      const p = new URLSearchParams(window.location.search);
      if (p.get('lang') === 'id') return true;
      return localStorage.getItem(LANG_KEY) === 'id';
    } catch { return false; }
  })();
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [boardColumnsConfig] = useState(() => getBoardColumnsConfig());
  const [columnStatuses] = useState(() => buildInitialColumnStatuses());
  const [nfcBoardId, setNfcBoardId] = useState('body'); // 鈑金 or 塗装

  const nfcTaskIdFromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('nfcTaskId') : null;
  // バインダー番号 → タスクID解決
  const binderResolvedId = useMemo(() => {
    if (!nfcBinderNumber || tasks.length === 0) return null;
    const found = tasks.find(t => t.binderNumber === nfcBinderNumber);
    return found ? found.id : null;
  }, [nfcBinderNumber, tasks]);
  const nfcTaskId = nfcTaskIdProp || nfcTaskIdFromUrl || binderResolvedId || null;

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setError('Firebaseの設定がありません。.env に VITE_FIREBASE_* を設定してください。');
      setIsLoading(false);
      return;
    }
    const unsubscribe = subscribeCollection('boards/main/tasks', (items) => {
      setTasks(Array.isArray(items) ? items : []);
      setIsLoading(false);
    });
    return () => unsubscribe && unsubscribe();
  }, []);

  const nfcTargetBoardId = nfcBoardId === 'paint' ? 'paint' : 'body';

  const boardColumns = useMemo(
    () => getColumnsForBoard(boardColumnsConfig, nfcTargetBoardId),
    [boardColumnsConfig, nfcTargetBoardId]
  );

  const getColumnStatusesForBoard = (boardId, col) => {
    if (!col || !col.id) return [];
    const custom = columnStatuses?.[boardId]?.[col.id];
    const list =
      Array.isArray(custom) && custom.length
        ? custom
        : Array.isArray(col.statuses)
        ? col.statuses
        : [col.id];
    return Array.isArray(list) ? list : [col.id];
  };

  const getPrimaryStatusForBoard = (boardId, col) => {
    const list = getColumnStatusesForBoard(boardId, col);
    return list && list[0] ? list[0] : col.id;
  };

  const task = tasks.find((t) => t.id === nfcTaskId) || null;
  const currentColumn = task
    ? boardColumns.find((col) => getColumnStatusesForBoard(nfcTargetBoardId, col).includes(task.status))
    : null;

  const [nextColumnId, setNextColumnId] = useState('');

  useEffect(() => {
    // 初期表示時に「現在と異なる最初の列」をデフォルト選択にする
    if (!task || !boardColumns.length) return;
    const firstDifferent = boardColumns.find((col) => {
      const primary = getPrimaryStatusForBoard(nfcTargetBoardId, col);
      return primary && primary !== task.status;
    });
    if (firstDifferent) setNextColumnId(firstDifferent.id);
  }, [task, boardColumns, nfcTargetBoardId]);

  const handleMove = async () => {
    if (!task) return;
    const col = boardColumns.find((c) => c.id === nextColumnId);
    if (!col) return;
    const primaryStatus = getPrimaryStatusForBoard(nfcTargetBoardId, col);
    if (!primaryStatus || primaryStatus === task.status) return;

    setIsSaving(true);
    setError('');
    setSuccess('');
    try {
      const updated = transitionTaskStatusWithOperator(task, primaryStatus, {}, currentUser || null);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      if (isFirebaseConfigured()) {
        await upsertDocument('boards/main/tasks', updated.id, updated);
      }
      setSuccess('列を移動しました。');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setError(e && e.message ? e.message : '列の移動に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const baseClasses =
  'min-h-screen bg-gray-100 flex flex-col items-stretch justify-start font-sans text-gray-800 text-base';

  return (
    <div className={baseClasses}>
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-500 shadow-sm border-2 border-white" />
          <div className="flex flex-col">
            <span className="text-xl font-semibold text-gray-500">BrightBoard - 清田自動車</span>
            <span className="text-2xl font-bold text-gray-800">NFC 列移動モード</span>
          </div>
        </div>
        {typeof onLogout === 'function' && (
          <button
            type="button"
            onClick={onLogout}
            className="text-xl px-5 py-2.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            ログアウト
          </button>
        )}
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-5">
        <div className="w-full max-w-md bg-white rounded-lg shadow-md border border-gray-200 p-5 space-y-4">
          {isLoading && <div className="text-xl text-gray-700">読み込み中です...</div>}
          {!isLoading && !nfcTaskId && nfcBinderNumber && (
            <div className="space-y-4 text-center">
              <div className="text-6xl font-black text-gray-300">{nfcBinderNumber}</div>
              <p className="font-semibold text-amber-700 text-xl">このバインダーは現在未割当です</p>
              <p className="text-gray-500 text-base">フロントでカードを作成し、バインダー No.{nfcBinderNumber} を選択してください。</p>
            </div>
          )}
          {!isLoading && !nfcTaskId && !nfcBinderNumber && (
            <div className="space-y-4 text-xl">
              <p className="font-semibold text-amber-700 text-xl">NFCタグのURLが正しくありません。</p>
              <p className="text-gray-700 text-base">
                バインダーのNFCタグまたはカード詳細のURLを使用してください。
              </p>
            </div>
          )}
          {!isLoading && nfcTaskId && !task && (
            <div className="text-xl text-red-600">
              このNFCタグに対応するカードが見つかりませんでした。カードが削除されていないか確認してください。
            </div>
          )}
          {!isLoading && task && (
            <>
              {error && (
                <div className="px-4 py-3 rounded bg-red-50 border border-red-200 text-xl text-red-700">
                  {error}
                </div>
              )}
              {success && (
                <div className="px-4 py-3 rounded bg-emerald-50 border border-emerald-200 text-xl text-emerald-700">
                  {success}
                </div>
              )}
              <div className="flex justify-between items-center gap-4">
                <span className="text-2xl text-gray-800 font-semibold">{useIndonesian ? 'Papan Tujuan' : '対象ボード'}</span>
                <select
                  className="border border-gray-300 rounded px-5 py-4 text-2xl bg-white font-medium"
                  value={nfcBoardId}
                  onChange={(e) => setNfcBoardId(e.target.value === 'paint' ? 'paint' : 'body')}
                >
                  <option value="body">{useIndonesian ? 'Bodyshop' : '鈑金ボード'}</option>
                  <option value="paint">{useIndonesian ? 'Paint' : '塗装ボード'}</option>
                </select>
              </div>
              <div className="text-sm text-gray-600 mb-1">{useIndonesian ? 'Kartu Tujuan' : '対象カード'}</div>
              <div className="px-3 py-2 rounded bg-gray-50 border border-gray-200 text-base">
                <div className="font-semibold text-gray-800 mb-1">
                  {task.assignee || '担当未設定'} / {task.car || '車種未設定'} {task.number || ''}
                </div>
                <div className="text-sm text-gray-600">
                  受付担当: {task.receptionStaff || currentUser || '未設定'}
                </div>
              </div>

              <div className="space-y-3 text-xl">
                <div className="flex justify-between items-center">
                  <span className="text-gray-800 text-xl font-semibold">{useIndonesian ? 'Kolom Saat Ini' : '現在の列'}</span>
                  <span className="px-4 py-2 rounded-full bg-blue-50 border border-blue-100 text-xl text-blue-700 font-semibold">
                    {currentColumn
                      ? getColumnName(currentColumn, useIndonesian)
                      : (useIndonesian ? 'Tidak dapat menentukan' : '判別できません')}
                  </span>
                </div>
                <div className="mt-4">
                  <label className="block text-xl text-gray-800 mb-3 font-semibold">{useIndonesian ? 'Kolom Tujuan' : '移動先の列'}</label>
                  <select
                    className="w-full border border-gray-300 rounded px-5 py-4 text-2xl bg-white font-medium"
                    value={nextColumnId}
                    onChange={(e) => setNextColumnId(e.target.value)}
                  >
                    <option value="">{useIndonesian ? 'Pilih kolom' : '列を選択してください'}</option>
                    {boardColumns.map((col) => (
                      <option key={col.id} value={col.id}>
                        {getColumnName(col, useIndonesian)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={handleMove}
                disabled={isSaving || !nextColumnId}
                className="w-full mt-6 px-6 py-5 rounded-xl bg-blue-600 text-white text-2xl font-bold tracking-wide hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSaving ? (useIndonesian ? 'Memindahkan...' : '列を移動中...') : (useIndonesian ? 'Pindah ke kolom ini' : 'この列に移動する')}
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// --- メインアプリ画面 ---
function KanbanApp({ currentUser = 'ログインユーザー', currentUserEmail = '', onLogout, nfcTaskId = null }) {
  const isDragOnly = currentUser === '現場端末'; // スマホ・タブレットはドラッグ移動のみ制限（キーボード入力・カード作成は許可）
  const isViewOnly = false; // 全端末でカード作成・編集を許可
  const [currentView, setCurrentView] = useState('board');
  const [isSendNotificationOpen, setIsSendNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [pastLoginUsers, setPastLoginUsers] = useState([]); // 目安箱の送り先リスト（過去にログインしたユーザー）
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const notificationPanelRef = useRef(null);
  // カード→目安箱DnD不具合通知用
  const [isIncidentReportOpen, setIsIncidentReportOpen] = useState(false);
  const [incidentReportTask, setIncidentReportTask] = useState(null);
  const [isCardDragActive, setIsCardDragActive] = useState(false);
  const [isMailboxDragOver, setIsMailboxDragOver] = useState(false);
  const [incidentToast, setIncidentToast] = useState(null); // { label } | null
  useEffect(() => {
    if (!incidentToast) return;
    const t = setTimeout(() => setIncidentToast(null), 1800);
    return () => clearTimeout(t);
  }, [incidentToast]);
  const [currentBoardId, setCurrentBoardId] = useState('main');
  const [tasks, setTasks] = useState(() => {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(TASKS_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [reservations, setReservations] = useState(() => {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(RESERVATIONS_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [fleetCars, setFleetCars] = useState(() => {
    try {
      if (typeof localStorage === 'undefined') return [...FLEET_CARS];
      const raw = localStorage.getItem(FLEET_CARS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : [...FLEET_CARS];
    } catch {
      return [...FLEET_CARS];
    }
  });
  const [rentalCompanies, setRentalCompanies] = useState([]);

  // 予約だけ存在してタスクがないケースを補完しておく（カードが消えないようにする）
  useEffect(() => {
    if (!Array.isArray(reservations) || reservations.length === 0) return;
    setTasks((prev) => {
      const existingIds = new Set(prev.map((t) => t.id));
      const additions = [];
      const nowIso = new Date().toISOString();
      reservations.forEach((res) => {
        if (!res.taskId || existingIds.has(res.taskId)) return;
        additions.push({
          id: res.taskId,
          status: 'unscheduled',
          color: 'bg-white',
          maker: '',
          car: '',
          number: '',
          colorNo: '',
          assignee: res.taskName || '',
          inDate: res.start || '',
          inTime: '09:00',
          outDate: res.end || '',
          loanerType: 'none',
          loanerCarId: res.carId || '',
          dots: ['white', 'white', 'white', 'white'],
          characters: [],
          tasks: [],
          statusEnteredAt: nowIso,
          statusHistory: [],
          attachments: [],
        });
      });
      if (!additions.length) return prev;
      const next = [...prev, ...additions];
      if (isFirebaseConfigured()) {
        additions.forEach((task) => {
          upsertDocument('boards/main/tasks', task.id, task).catch(() => {});
        });
      }
      return next;
    });
  }, [reservations]);

  // 納車完了履歴: 納車ワークフロー（delivery_wait/delivery_today/delivered_*）を経たカードのみ表示
  // 他ボードで completed になっただけのカードは納車履歴に表示しない
  const DELIVERY_SPECIFIC_STATUSES = new Set(['delivery_wait', 'delivery_today', 'delivered_unpaid', 'delivered_paid']);
  const deliveryCompletedTasks = useMemo(() => {
    if (currentBoardId !== 'delivery') return [];
    return tasks
      .filter((t) => {
        if (!t || t.status !== 'completed') return false;
        // statusHistory に納車ボード固有のステータスが1つでもあれば、納車ワークフローを経たカード
        const hist = Array.isArray(t.statusHistory) ? t.statusHistory : [];
        return hist.some(h => h && DELIVERY_SPECIFIC_STATUSES.has(h.status));
      })
      .slice()
      .sort((a, b) => {
        const getTime = (task) => {
          const d = task.outDate || task.statusEnteredAt;
          if (!d) return 0;
          const dt = new Date(d);
          return Number.isNaN(dt.getTime()) ? 0 : dt.getTime();
        };
        return getTime(b) - getTime(a);
      });
  }, [currentBoardId, tasks]);

  // 納車完了履歴: 月別グループ化・検索・折りたたみ
  const [deliveryHistorySearch, setDeliveryHistorySearch] = useState('');
  const [collapsedMonths, setCollapsedMonths] = useState({});
  const deliveryHistoryFiltered = useMemo(() => {
    if (!deliveryHistorySearch.trim()) return deliveryCompletedTasks;
    const q = deliveryHistorySearch.trim().toLowerCase();
    return deliveryCompletedTasks.filter(t => {
      const text = `${t.assignee || ''} ${t.car || ''} ${t.number || ''}`.toLowerCase();
      return text.includes(q);
    });
  }, [deliveryCompletedTasks, deliveryHistorySearch]);
  const deliveryHistoryByMonth = useMemo(() => {
    const groups = [];
    let currentKey = '';
    let currentGroup = null;
    deliveryHistoryFiltered.forEach(task => {
      const d = task.outDate || task.statusEnteredAt || '';
      const dt = d ? new Date(d) : null;
      const key = dt && !Number.isNaN(dt.getTime())
        ? `${dt.getFullYear()}年${dt.getMonth() + 1}月`
        : '日付不明';
      if (key !== currentKey) {
        currentKey = key;
        currentGroup = { key, tasks: [] };
        groups.push(currentGroup);
      }
      currentGroup.tasks.push(task);
    });
    return groups;
  }, [deliveryHistoryFiltered]);

  // --- 異常検知: 後工程にいたカードが入庫済みに戻っている場合を検出 ---
  const LATER_STAGE_STATUSES = new Set([
    'b_wait', 'b_doing', 'b_done_p_wait', 'p_only', 'prep', 'prep_done', 'prep_p',
    'painting', 'assembly_wait', 'assembly', 'polish', 'polishing',
    'completed', 'assembly_done_both', 'assembly_done_nuri', 'polish_done',
    'delivery_wait', 'delivery_today', 'delivered_unpaid', 'delivered_paid'
  ]);
  const anomalousReceivedTasks = useMemo(() => {
    return tasks.filter(t => {
      if (!t || t.status !== 'received') return false;
      const hist = Array.isArray(t.statusHistory) ? t.statusHistory : [];
      // 後工程のステータスを経たことがあるのに received に戻っているカードを検出
      return hist.some(h => h && LATER_STAGE_STATUSES.has(h.status));
    });
  }, [tasks]);

  const [showAnomalyBanner, setShowAnomalyBanner] = useState(true);
  const [isRecoveryPanelOpen, setIsRecoveryPanelOpen] = useState(false);

  // 異常カードを直前の適切なステータスに一括復元する
  const batchRestoreAnomalousTasks = () => {
    if (anomalousReceivedTasks.length === 0) return;
    const msg = `${anomalousReceivedTasks.length} 件のカードを、入庫済みに来る前のステータスに戻します。よろしいですか？`;
    if (!window.confirm(msg)) return;
    let restoredCount = 0;
    setTasks(prev => prev.map(t => {
      if (!t || t.status !== 'received') return t;
      const hist = Array.isArray(t.statusHistory) ? t.statusHistory : [];
      if (!hist.some(h => h && LATER_STAGE_STATUSES.has(h.status))) return t;
      // statusHistory を逆順で走査し、received 以外の最新ステータスを復元先にする
      const restoreEntry = [...hist].reverse().find(h => h && h.status && h.status !== 'received');
      if (!restoreEntry) return t;
      restoredCount++;
      const updated = transitionTaskStatus(t, restoreEntry.status);
      if (isFirebaseConfigured()) upsertDocument('boards/main/tasks', updated.id, updated).catch(() => {});
      return updated;
    }));
    showSettingsToast(`${restoredCount}件のカードを復元しました`);
  };

  // データエクスポート: 全カードの現状をJSONでダウンロード
  const exportTasksAsJson = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      taskCount: tasks.length,
      tasks: tasks.map(t => ({ ...t }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brightboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showSettingsToast('バックアップをダウンロードしました');
  };

  const restoreFromDeliveryHistory = (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status !== 'completed') return;
    // 復元先は納車ボードのステータスのみ許可（他ボードのステータスに戻ることを防止）
    const DELIVERY_VALID_RESTORE = new Set(['delivery_wait', 'delivery_today', 'delivered_unpaid', 'delivered_paid']);
    let prevStatus = getPreviousStatus(task);
    if (!DELIVERY_VALID_RESTORE.has(prevStatus)) {
      // statusHistory を遡って最後の納車ボードステータスを探す
      const hist = Array.isArray(task.statusHistory) ? task.statusHistory : [];
      const lastDeliveryEntry = [...hist].reverse().find(h => h && DELIVERY_VALID_RESTORE.has(h.status));
      prevStatus = lastDeliveryEntry ? lastDeliveryEntry.status : 'delivery_wait';
    }
    const updated = transitionTaskStatus(task, prevStatus);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
    if (isFirebaseConfigured()) {
      upsertDocument('boards/main/tasks', updated.id, updated);
    }
  };
  const handleMasterDeleteTask = (taskId) => {
    const target = tasks.find((t) => t.id === taskId);
    if (!target) return;
    // 紐づく代車予約を削除
    setReservations((prev) => {
      const related = prev.filter((r) => r.taskId === taskId);
      if (isFirebaseConfigured() && related.length > 0) {
        related.forEach((r) => {
          deleteDocument('boards/main/reservations', r.id).catch(() => {});
        });
      }
      return prev.filter((r) => r.taskId !== taskId);
    });
    // タスク本体を削除
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (isFirebaseConfigured()) {
      deleteDocument('boards/main/tasks', taskId).catch(() => {});
    }
    setSelectedTaskId(null);
  };
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCalendarLinkModalOpen, setIsCalendarLinkModalOpen] = useState(false);
  const [calendarToast, setCalendarToast] = useState('');
  const [settingsSaveToast, setSettingsSaveToast] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  // 1分ごとに再レンダリングして滞在時間表示を更新
  const [, setElapsedTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setElapsedTick(t => t + 1), 60000); return () => clearInterval(id); }, []);
  const [selectedTaskId, setSelectedTaskId] = useState(nfcTaskId || null);

  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isSearchMenuOpen, setIsSearchMenuOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLinkSettingsOpen, setIsLinkSettingsOpen] = useState(false);
  const [isFleetSettingsOpen, setIsFleetSettingsOpen] = useState(false);
  const [isRentalCompaniesSettingsOpen, setIsRentalCompaniesSettingsOpen] = useState(false);
  const [isColumnEditOpen, setIsColumnEditOpen] = useState(false);
  const [isStaffOptionsOpen, setIsStaffOptionsOpen] = useState(false);
  const [isInvoiceSettingsOpen, setIsInvoiceSettingsOpen] = useState(false);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [useIndonesian, setUseIndonesian] = useState(() => {
    try {
      return (typeof localStorage !== 'undefined' && localStorage.getItem(LANG_KEY) === 'id');
    } catch { return false; }
  });
  const toggleIndonesian = () => {
    const next = !useIndonesian;
    setUseIndonesian(next);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, next ? 'id' : 'ja');
    } catch (_) {}
  };
  const [orphanRecoverySelection, setOrphanRecoverySelection] = useState({});
  const [orphanSearchText, setOrphanSearchText] = useState('');
  const [boardColumnsConfig, setBoardColumnsConfig] = useState(() => getBoardColumnsConfig());
  const [staffOptionsConfig, setStaffOptionsConfig] = useState(() => getStaffOptionsConfig());
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
  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined' && boardColumnsConfig && Object.keys(boardColumnsConfig).length > 0)
        localStorage.setItem(BOARD_COLUMNS_KEY, JSON.stringify(boardColumnsConfig));
      else if (typeof localStorage !== 'undefined') localStorage.removeItem(BOARD_COLUMNS_KEY);
    } catch (_) {}
  }, [boardColumnsConfig]);
  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined' && staffOptionsConfig)
        localStorage.setItem(STAFF_OPTIONS_KEY, JSON.stringify(staffOptionsConfig));
    } catch (_) {}
  }, [staffOptionsConfig]);
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    const unsubscribe = subscribeCollection('meta', (items) => {
      const staffDoc = items.find((it) => it.id === 'staffOptions');
      if (staffDoc) {
        setStaffOptionsConfig((prev) => {
          const fromDoc = (key, fallbackEmpty) => {
            const arr = staffDoc[key];
            if (Array.isArray(arr) && arr.length > 0) return arr.filter((s) => typeof s === 'string');
            if (prev && Array.isArray(prev[key]) && prev[key].length > 0) return prev[key];
            return key === 'reception' ? [...RECEPTION_STAFF_OPTIONS] : fallbackEmpty;
          };
          const receptionRaw = fromDoc('reception', []);
          const next = {
            reception: ensureReceptionStaffBase(receptionRaw),
            body: fromDoc('body', []),
            paint: fromDoc('paint', []),
          };
          try {
            if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
          } catch {
            // ignore
          }
          return next;
        });
      }
      const linkDoc = items.find((it) => it.id === 'linkConfig');
      if (linkDoc && linkDoc.data && typeof linkDoc.data === 'object' && !Array.isArray(linkDoc.data)) {
        const base = buildInitialColumnStatuses();
        let hasAny = false;
        Object.keys(linkDoc.data).forEach((bid) => {
          if (base[bid] && linkDoc.data[bid] && typeof linkDoc.data[bid] === 'object' && !Array.isArray(linkDoc.data[bid])) {
            Object.keys(linkDoc.data[bid]).forEach((cid) => {
              const arr = linkDoc.data[bid][cid];
              if (Array.isArray(arr) && arr.length > 0) {
                base[bid][cid] = arr;
                hasAny = true;
              }
            });
          }
        });
        setColumnStatuses((prev) => {
          try {
            if (JSON.stringify(prev) === JSON.stringify(base)) return prev;
            if (!hasAny && prev && typeof prev === 'object' && Object.keys(prev).length > 0) return prev;
          } catch {
            // ignore
          }
          return base;
        });
      }
    });
    return () => unsubscribe && unsubscribe();
  }, []);
  const showSettingsToast = (message) => {
    setSettingsSaveToast(message);
    setTimeout(() => setSettingsSaveToast(''), 4000);
  };
  const handleSaveStaffOptions = async (nextConfig) => {
    // 受付担当者は米田・鶴田・あすか・佃の4名を必ず含めてFirestoreに保存（消えないようにする）
    const merged = {
      ...nextConfig,
      reception: ensureReceptionStaffBase(nextConfig?.reception || []),
    };
    setStaffOptionsConfig(merged);
    if (isFirebaseConfigured()) {
      try {
        await upsertDocument('meta', 'staffOptions', merged);
        showSettingsToast('担当者一覧を保存しました（他PCと共有されます）');
      } catch (e) {
        showSettingsToast('保存に失敗しました。通信を確認してください。');
      }
    }
  };
  const handleSaveLinkConfig = async (nextData) => {
    setColumnStatuses(nextData);
    if (isFirebaseConfigured()) {
      try {
        await upsertDocument('meta', 'linkConfig', { data: nextData });
        showSettingsToast('ボード間リンクを保存しました（他PCと共有されます）');
      } catch (e) {
        showSettingsToast('保存に失敗しました。通信を確認してください。');
      }
    } else {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(LINK_CONFIG_KEY, JSON.stringify(nextData));
        showSettingsToast('ボード間リンクをローカルに保存しました');
      } catch (_) {}
    }
  };
  const handleSaveFleet = async (newFleet) => {
    const nextIds = new Set((newFleet || []).map(c => c.id));
    const removedIds = (fleetCars || []).filter(c => !nextIds.has(c.id)).map(c => c.id);
    if (isFirebaseConfigured()) {
      try {
        await Promise.all(removedIds.map(id => deleteDocument('fleetCars', id)));
        const related = reservations.filter(r => removedIds.includes(r.carId));
        await Promise.all(related.map(r => deleteDocument('boards/main/reservations', r.id)));
      } catch (e) {
        showSettingsToast('代車マスタの一部削除に失敗しました。');
      }
    }
    if (removedIds.length > 0) {
      setReservations(prev => prev.filter(r => !removedIds.includes(r.carId)));
      setTasks(prev => prev.map(t => removedIds.includes(t.loanerCarId) ? { ...t, loanerCarId: '', loanerType: 'none' } : t));
    }
    if (isFirebaseConfigured()) {
      try {
        await Promise.all((newFleet || []).map(car => upsertDocument('fleetCars', car.id, car)));
        showSettingsToast('代車マスタを保存しました（他PCと共有されます）');
      } catch (e) {
        showSettingsToast('代車マスタの保存に失敗しました。通信を確認してください。');
      }
    }
    setFleetCars(Array.isArray(newFleet) ? newFleet : []);
  };
  const handleSaveRentalCompanies = async (nextCompanies) => {
    const nextList = Array.isArray(nextCompanies) ? nextCompanies : [];
    const nextIds = new Set(nextList.map(c => c.id));
    const removedIds = (rentalCompanies || []).filter(c => !nextIds.has(c.id)).map(c => c.id);
    if (isFirebaseConfigured()) {
      try {
        await Promise.all(removedIds.map(id => deleteDocument('rentalCompanies', id)));
        await Promise.all(nextList.map(c => upsertDocument('rentalCompanies', c.id, c)));
        showSettingsToast('レンタル会社マスタを保存しました');
      } catch (e) {
        showSettingsToast('レンタル会社マスタの保存に失敗しました。通信を確認してください。');
      }
    }
    setRentalCompanies(nextList);
  };
  const [searchFilters, setSearchFilters] = useState({
    assignee: '', maker: '', car: '', receptionStaff: '', bodyStaff: '', paintStaff: '', number: '', color: ''
  });
  const [columnWidthConfig, setColumnWidthConfig] = useState(() => getColumnWidthConfig());
  const [columnMinWidth, setColumnMinWidth] = useState(() => getColumnMinWidthByViewport(getColumnWidthConfig()));
  const [collapsedWeeks, setCollapsedWeeks] = useState({});

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined' && columnWidthConfig)
        localStorage.setItem(COLUMN_WIDTH_KEY, JSON.stringify(columnWidthConfig));
    } catch (_) {}
  }, [columnWidthConfig]);

  useEffect(() => {
    const updateWidth = () => setColumnMinWidth(getColumnMinWidthByViewport(columnWidthConfig ?? DEFAULT_COLUMN_WIDTH));
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [columnWidthConfig]);

  const headerMenuRef = useRef(null);
  const projectMenuRef = useRef(null);
  const searchMenuRef = useRef(null);
  const accountMenuRef = useRef(null);

  useOutsideClick(headerMenuRef, () => setIsHeaderMenuOpen(false));
  useOutsideClick(projectMenuRef, () => setIsProjectMenuOpen(false));
  useOutsideClick(searchMenuRef, () => setIsSearchMenuOpen(false));
  useOutsideClick(accountMenuRef, () => setIsAccountMenuOpen(false));
  useOutsideClick(notificationPanelRef, () => setIsNotificationPanelOpen(false));

  // 自分あての通知を購読（toEmail === currentUserEmail）
  useEffect(() => {
    if (!isFirebaseConfigured()) return () => {};
    const myEmail = (currentUserEmail || '').toLowerCase();
    if (!myEmail) return () => {};
    const unsubscribe = subscribeCollection('notifications', (items) => {
      const mine = (items || [])
        .filter((n) => (n.toEmail || '').toLowerCase() === myEmail)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setNotifications(mine);
    });
    return () => unsubscribe && unsubscribe();
  }, [currentUserEmail]);

  // 過去にログインしたユーザー一覧（目安箱の送り先リスト用）
  useEffect(() => {
    if (!isFirebaseConfigured()) return () => {};
    const unsub = subscribeCollection('users', (items) => {
      const list = (items || [])
        .filter((u) => (u.email || '').trim())
        .map((u) => ({ id: u.id, email: (u.email || '').toLowerCase(), displayName: u.displayName || u.email || '', lastLoginAt: u.lastLoginAt || '' }))
        .sort((a, b) => (b.lastLoginAt || '').localeCompare(a.lastLoginAt || ''));
      setPastLoginUsers(list);
    });
    return () => unsub && unsub();
  }, []);

  // 通知パネルを開いたとき（false→true の瞬間）に未読を既読にする
  const prevNotificationPanelOpen = useRef(false);
  useEffect(() => {
    const justOpened = isNotificationPanelOpen && !prevNotificationPanelOpen.current;
    prevNotificationPanelOpen.current = isNotificationPanelOpen;
    if (!justOpened || !isFirebaseConfigured()) return;
    const unread = notifications.filter((n) => !n.read);
    unread.forEach((n) => {
      upsertDocument('notifications', n.id, { ...n, read: true }).catch(() => {});
    });
  }, [isNotificationPanelOpen, notifications]);
  const enableWeekGrouping = currentBoardId === 'planning';
  const isNfcMode = !!nfcTaskId;
  const [nfcBoardId, setNfcBoardId] = useState('body');

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || null;

  // NFCタグ経由で開かれた場合は、対象カードを選択し、指定ボード（鈑金 or 塗装）を表示
  useEffect(() => {
    if (!nfcTaskId) return;
    // NFCモードでは鈑金ボード（body）または塗装ボード（paint）を対象にする
    const targetBoard = nfcBoardId === 'paint' ? 'paint' : 'body';
    setCurrentBoardId(targetBoard);
    setCurrentView('board');
    setSelectedTaskId(nfcTaskId);
  }, [nfcTaskId, nfcBoardId]);

  // ローカルキャッシュ（ブラウザ単位）に保存
  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(TASKS_CACHE_KEY, JSON.stringify(tasks));
      }
    } catch (_) {}
  }, [tasks]);

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(RESERVATIONS_CACHE_KEY, JSON.stringify(reservations));
      }
    } catch (_) {}
  }, [reservations]);

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(FLEET_CARS_KEY, JSON.stringify(fleetCars));
      }
    } catch (_) {}
  }, [fleetCars]);

  // Firestore リアルタイム購読（タスク・代車予約・代車マスタ）
  useEffect(() => {
    if (!isFirebaseConfigured()) {
      // Firebase 未設定時はローカルのダミーデータを使用
      setTasks(INITIAL_TASKS);
      setReservations(INITIAL_RESERVATIONS);
      setFleetCars(prev => (Array.isArray(prev) && prev.length > 0) ? prev : [...FLEET_CARS]);
      return;
    }
    const db = getFirestoreDb();
    if (!db) return;
    const unsubscribeTasks = subscribeCollection('boards/main/tasks', (items) => {
      if (Array.isArray(items) && items.length > 0) {
        setTasks(items);
      }
      // 0件の場合は「何もない」というサーバー状態だが、
      // ローカルの編集中データを消してしまわないよう、明示的なクリアはしない
    });
    const unsubscribeReservations = subscribeCollection('boards/main/reservations', (items) => {
      if (Array.isArray(items) && items.length > 0) {
        setReservations(items);
      }
    });
    const unsubscribeFleet = subscribeCollection('fleetCars', (items) => {
      const list = Array.isArray(items) ? items : [];
      setFleetCars((prev) => {
        if (list.length > 0) return list;
        if (Array.isArray(prev) && prev.length > 0) return prev;
        return list;
      });
      if (list.length > 0) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(FLEET_CARS_KEY, JSON.stringify(list));
          }
        } catch (_) {}
      }
    });
    const unsubscribeRentalCompanies = subscribeCollection('rentalCompanies', (items) => {
      setRentalCompanies(Array.isArray(items) ? items : []);
    });
    return () => {
      unsubscribeTasks && unsubscribeTasks();
      unsubscribeReservations && unsubscribeReservations();
      unsubscribeFleet && unsubscribeFleet();
      unsubscribeRentalCompanies && unsubscribeRentalCompanies();
    };
  }, []);

  // 代車マスタは Firestore（設定で保存したマスタ）を正とする。ローカルやデフォルトで上書きしない。

  const handleCardDrop = (e, targetTaskId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedTaskId || draggedTaskId === targetTaskId) return;
    const getOrder = (t) => (typeof t.order === 'number' ? t.order : null);
    setTasks((prev) => {
      const dragged = prev.find((t) => t.id === draggedTaskId);
      const target = prev.find((t) => t.id === targetTaskId);
      if (!dragged || !target || !dragged.status || dragged.status !== target.status) return prev;
      const sameStatus = prev
        .filter((t) => t.status === dragged.status)
        .slice()
        .sort((a, b) => {
          const oa = getOrder(a);
          const ob = getOrder(b);
          if (oa != null && ob != null) return oa - ob;
          if (oa != null) return -1;
          if (ob != null) return 1;
          return 0;
        });
      const fromIndex = sameStatus.findIndex((t) => t.id === dragged.id);
      const toIndex = sameStatus.findIndex((t) => t.id === target.id);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
      const reordered = sameStatus.slice();
      const [moved] = reordered.splice(fromIndex, 1);
      const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
      reordered.splice(insertIndex, 0, moved);
      reordered.forEach((t, index) => {
        t.order = index;
      });
      if (isFirebaseConfigured()) {
        reordered.forEach((t) => {
          upsertDocument('boards/main/tasks', t.id, t).catch(() => {});
        });
      }
      const byId = new Map(reordered.map((t) => [t.id, t]));
      return prev.map((t) => (byId.has(t.id) ? { ...t, order: byId.get(t.id).order } : t));
    });
    setDraggedTaskId(null);
  };

  const renderTaskCard = (task) => {
    const receptionInitial = ((task.receptionStaff || task.assignee || '') || '').trim().charAt(0) || '';
    const entryDetailInitial = ((task.entryDetail || '') || '').trim().charAt(0) || '';
    const hasLoaner = task.loanerType && task.loanerType !== 'none';
    return (
    <div
      key={task.id}
      draggable={!isDragOnly}
      onDragStart={(e) => handleDragStart(e, task.id)}
      onDragEnd={() => setDraggedTaskId(null)}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!isDragOnly) e.dataTransfer.dropEffect = 'move'; }}
      onDrop={(e) => {
        if (isDragOnly) return;
        const dragged = tasks.find(t => t.id === draggedTaskId);
        // 別ステータス（別の列）からドラッグしてきた場合は、
        // カード上ではなく列全体の onDrop でステータス変更を扱いたいので何もしない。
        if (!dragged || !dragged.status || dragged.status !== task.status) {
          return;
        }
        handleCardDrop(e, task.id);
      }}
      onClick={() => setSelectedTaskId(task.id)}
      title={task.description || ''}
      className={`${task.color || 'bg-white'} rounded shadow-sm border p-2 ${isDragOnly ? 'cursor-default' : 'cursor-pointer active:cursor-grabbing hover:bg-gray-50'} relative overflow-hidden group ${selectedTaskId === task.id ? 'border-2 border-red-500 ring-1 ring-red-500 ring-opacity-50' : 'border-gray-200'}`}
    >
      {task.color !== 'bg-white' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-black opacity-10"></div>}
      <div className="text-xs font-medium text-gray-800 mb-1 leading-tight">
        <div className="flex items-center justify-between gap-1 mb-0.5 whitespace-nowrap">
          <div className="flex items-center gap-1 flex-shrink-0">
            {receptionInitial && (
              <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-gray-800 text-white text-[10px] font-medium" title="入庫担当者">{receptionInitial}</span>
            )}
            {entryDetailInitial && (
              <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-gray-300 text-gray-800 text-[10px] font-medium" title="入庫ジャンル詳細">{entryDetailInitial}</span>
            )}
          </div>
          {hasLoaner && (() => {
            const info = computeLoanerDayInfo(task);
            const letter = task.loanerType === 'other_rental' ? '他' : task.loanerType === 'rental' ? 'レ' : '代';
            const baseColor = task.loanerType === 'other_rental' ? 'bg-orange-100 text-orange-800' : task.loanerType === 'rental' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800';
            const overrunColor = 'bg-red-100 text-red-800 ring-1 ring-red-400';
            const color = info?.isOverrun ? overrunColor : baseColor;
            const dayLabel = info && info.elapsedDays
              ? (info.plannedDays ? `${info.elapsedDays}/${info.plannedDays}日` : `${info.elapsedDays}日`)
              : '';
            const pin = info?.isLongTerm ? '📌' : '';
            const companyLabel = task.loanerType === 'other_rental' ? (task.otherRentalName || '') : '';
            const titleParts = [LOANER_OPTIONS.find(o=>o.id===task.loanerType)?.label];
            if (companyLabel) titleParts.push(companyLabel);
            if (info?.elapsedDays) titleParts.push(`貸出 ${info.elapsedDays}日目${info.plannedDays ? ` / 予定 ${info.plannedDays}日` : ''}`);
            if (info?.isOverrun) titleParts.push('⚠ 予定日数を超過');
            if (info?.isLongTerm) titleParts.push('📌 10日以上の長期貸出');
            return (
              <div
                className={`flex items-center px-0.5 rounded gap-0.5 text-[9px] flex-shrink-0 ${color}`}
                title={titleParts.filter(Boolean).join(' / ')}
              >
                <Truck className="w-3 h-3 flex-shrink-0" />
                <span className="flex-shrink-0">{letter}{dayLabel ? ` ${dayLabel}` : ''}{pin}</span>
              </div>
            );
          })()}
        </div>
        {task.assignee}<br/>{task.car} {task.number}<br/>
        <span className="text-gray-500 font-normal inline-block mt-0.5">{formatInOutDate(task.inDate, task.outDate)}</span>
        {task.statusEnteredAt && (() => {
          const elapsed = formatElapsedTime(task.statusEnteredAt);
          if (!elapsed) return null;
          const ms = Date.now() - new Date(task.statusEnteredAt).getTime();
          const days = Math.floor(ms / (1000 * 60 * 60 * 24));
          const cls = days >= 5 ? 'text-red-700 bg-red-50' : days >= 3 ? 'text-amber-700 bg-amber-50' : 'text-gray-500 bg-gray-100';
          return <span className={`text-[9px] px-1 rounded ml-1 ${cls}`} title="この列での滞在時間">{elapsed}</span>;
        })()}
      </div>
      <div className="flex gap-1 mb-1 text-gray-500">
        {task.characters?.map(cId => { const Icon = AVAILABLE_CHARACTERS.find(c => c.id === cId)?.icon; return Icon ? <Icon key={cId} className="w-3.5 h-3.5" /> : null; })}
        {task.tasks?.map(tId => { const Icon = AVAILABLE_TASKS.find(t => t.id === tId)?.icon; return Icon ? <Icon key={tId} className="w-3.5 h-3.5" /> : null; })}
      </div>
      <div className="mt-2 flex gap-1">
        {task.dots.map((dotColor, i) => (
          <div
            key={i}
            className={`w-2.5 h-2.5 rounded-full border border-gray-400 ${
              dotColor === 'red'
                ? 'bg-red-500'
                : dotColor === 'yellow'
                ? 'bg-yellow-400'
                : dotColor === 'blue'
                ? 'bg-blue-500'
                : dotColor === 'green'
                ? 'bg-green-500'
                : dotColor === 'black'
                ? 'bg-black'
                : dotColor === 'brown'
                ? 'bg-amber-800'
                : 'bg-white'
            }`}
          ></div>
        ))}
      </div>
      {/* ホバー時の説明＋画像サムネイルポップアップ */}
      {(task.description || (Array.isArray(task.attachments) && task.attachments.some(att => att.type === 'image'))) && (
        <div className="pointer-events-none absolute inset-x-0 -top-1/2 z-40 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="mx-auto max-w-xs rounded-lg shadow-xl bg-white border border-gray-200 p-2 text-[11px] text-gray-800">
            {task.description && (
              <div className="mb-1 line-clamp-3 whitespace-pre-wrap break-words">
                {task.description}
              </div>
            )}
            {Array.isArray(task.attachments) && (
              (() => {
                const img = task.attachments.find(att => att.type === 'image' && att.data);
                if (!img) return null;
                return (
                  <div className="mt-1">
                    <img
                      src={img.data}
                      alt={img.name || 'attachment'}
                      className="w-full max-h-32 object-contain rounded border border-gray-200 bg-gray-50"
                    />
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}
    </div>
    );
  };

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
    const loanerTypeParam = (params.get('loanerType') || 'none').trim();
    const allowedLoanerIds = LOANER_OPTIONS.map((o) => o.id);
    const loanerType = allowedLoanerIds.includes(loanerTypeParam) ? loanerTypeParam : 'none';
    const loanerCarId = (params.get('loanerCarId') || '').trim();

    const newTask = {
      id: `t${Date.now()}`,
      status,
      color: 'bg-white',
      maker: '',
      car: (car || '').replace(/^（.*）$/, '$1'),
      number: (number || '').replace(/^（.*）$/, '$1'),
      colorNo: (params.get('colorNo') || '').trim(),
      assignee: (assignee || '').replace(/^（.*）$/, '$1'),
      inDate: inDate || '',
      inTime: inTime || '',
      outDate: '',
      loanerType,
      loanerCarId,
      dots: ['white', 'white', 'white', 'white'],
      characters: [],
      tasks: [],
      statusEnteredAt: nowIso,
      statusHistory: [],
      attachments
    };
    setTasks(prev => [...prev, newTask]);
    if (isFirebaseConfigured()) {
      upsertDocument('boards/main/tasks', newTask.id, newTask);
      if (newTask.loanerCarId && newTask.inDate) {
        const resId = `res${Date.now()}`;
        const reservation = {
          id: resId,
          carId: newTask.loanerCarId,
          taskId: newTask.id,
          taskName: `${newTask.assignee || '未設定'} ${newTask.car || '新規車両'}`.trim(),
          start: newTask.inDate,
          end: newTask.outDate || newTask.inDate,
          color: newTask.color || 'bg-blue-400'
        };
        setReservations(prev => [...prev, reservation]);
        upsertDocument('boards/main/reservations', resId, reservation).catch(() => {});
      }
    }
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
  const hasActiveFilters = Object.values(searchFilters).some(v => v && v.trim() !== '');

  // 納車ボード: 支払い済み列は表示しない。完了に置いたカードは看板に表示しない（データは残す）
  const boardColumns = currentBoardId === 'delivery'
    ? getColumnsForBoard(boardColumnsConfig, currentBoardId).filter(c => c.id !== 'delivered_paid')
    : getColumnsForBoard(boardColumnsConfig, currentBoardId);

  // NFCタグ読み込みモードでの移動先候補用: 鈑金ボード or 塗装ボードの列一覧
  const nfcTargetBoardId = nfcBoardId === 'paint' ? 'paint' : 'body';
  const nfcBoardColumns = getColumnsForBoard(boardColumnsConfig, nfcTargetBoardId);
  const hideColumnCards = (colId) => currentBoardId === 'delivery' && colId === 'completed';

  const getColumnStatuses = (col) => {
    if (!col || !col.id) return [];
    const custom = columnStatuses?.[currentBoardId]?.[col.id];
    const list = (Array.isArray(custom) && custom.length) ? custom : (Array.isArray(col.statuses) ? col.statuses : [col.id]);
    return Array.isArray(list) ? list : [col.id];
  };
  const getColumnStatusesForBoard = (boardId, col) => {
    if (!col || !col.id) return [];
    const custom = columnStatuses?.[boardId]?.[col.id];
    const list = (Array.isArray(custom) && custom.length) ? custom : (Array.isArray(col.statuses) ? col.statuses : [col.id]);
    return Array.isArray(list) ? list : [col.id];
  };
  const getColumnPrimaryStatus = (col) => {
    if (!col || !col.id) return null;
    const list = getColumnStatuses(col);
    return (list && list[0]) ? list[0] : col.id;
  };
  const getColumnPrimaryStatusForBoard = (boardId, col) => {
    if (!col || !col.id) return col.id;
    const list = getColumnStatusesForBoard(boardId, col);
    return (list && list[0]) ? list[0] : col.id;
  };

  const allValidStatuses = useMemo(() => {
    const set = new Set();
    BOARD_ORDER.forEach(bid => {
      const cols = getColumnsForBoard(boardColumnsConfig, bid);
      (cols || []).forEach(col => {
        const list = getColumnStatusesForBoard(bid, col);
        if (Array.isArray(list)) list.forEach(s => set.add(s));
      });
    });
    return set;
  }, [boardColumnsConfig, columnStatuses]);

  const historyEntries = useMemo(() => {
    const entries = [];
    tasks.forEach((task) => {
      if (!task) return;
      const hist = Array.isArray(task.statusHistory) ? task.statusHistory : [];
      hist.forEach((h, index) => {
        const fromStatus = h && h.status ? h.status : null;
        let toStatus = h && h.nextStatus ? h.nextStatus : null;
        // 過去データなどで nextStatus が無い場合は、次の履歴や現在の status から推定する
        if (!toStatus) {
          const nextHist = hist[index + 1];
          if (nextHist && nextHist.status && nextHist.status !== fromStatus) {
            toStatus = nextHist.status;
          } else if (!nextHist && task.status && task.status !== fromStatus) {
            toStatus = task.status;
          }
        }
        const byUser = h && typeof h.byUser === 'string' ? h.byUser : null;
        const enteredAt = h && h.enteredAt ? h.enteredAt : null;
        const exitedAt = h && h.exitedAt ? h.exitedAt : null;
        const at = exitedAt || enteredAt || null;
        entries.push({
          id: `${task.id}-${index}`,
          taskId: task.id,
          taskLabel: `${task.assignee || '担当未設定'} / ${task.car || '車種未設定'} ${task.number || ''}`,
          fromStatus,
          toStatus,
          byUser,
          enteredAt,
          exitedAt,
          at
        });
      });
    });
    entries.sort((a, b) => {
      const aTime = a.at || '';
      const bTime = b.at || '';
      return aTime < bTime ? 1 : aTime > bTime ? -1 : 0;
    });
    return entries;
  }, [tasks]);

  const orphanedTasks = useMemo(() =>
    tasks.filter(t => t && t.status != null && !allValidStatuses.has(t.status)),
    [tasks, allValidStatuses]
  );

  const searchAllTasksByText = useMemo(() => {
    const q = (orphanSearchText || '').trim().toLowerCase();
    if (!q) return [];
    return tasks.filter(t => {
      if (!t) return false;
      const num = (t.number || '').toString().toLowerCase();
      const car = (t.car || '').toString().toLowerCase();
      const assignee = (t.assignee || '').toString().toLowerCase();
      return num.includes(q) || car.includes(q) || assignee.includes(q);
    });
  }, [tasks, orphanSearchText]);

  const PLANNING_STATUSES = new Set(['unscheduled', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'received']);
  const unscheduledWithInDate = useMemo(() => {
    return tasks.filter(t => {
      if (!t || t.status !== 'unscheduled' || !t.inDate || Number.isNaN(new Date(t.inDate).getTime())) return false;
      const hist = Array.isArray(t.statusHistory) ? t.statusHistory : [];
      // 他ボード由来のカードは除外（unscheduledFromOtherBoard で扱う）
      if (hist.some(h => h && h.status && !PLANNING_STATUSES.has(h.status))) return false;
      return true;
    });
  }, [tasks]);
  // 改善版: 全履歴を走査して非planningステータスを検出（最後の1件だけでなく、納車完了等からの巻き戻しも検知）
  const unscheduledFromOtherBoard = useMemo(() => {
    return tasks.filter(t => {
      if (!t || t.status !== 'unscheduled') return false;
      const hist = Array.isArray(t.statusHistory) ? t.statusHistory : [];
      if (hist.length === 0) return false;
      // 全履歴を走査: 1つでも非planningステータスがあれば「他ボードから来たカード」と判定
      return hist.some(h => h && h.status && !PLANNING_STATUSES.has(h.status));
    });
  }, [tasks]);

  const redistributeUnscheduledByInDate = () => {
    if (unscheduledWithInDate.length === 0) return;
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    setTasks(prev => prev.map(t => {
      if (!t || t.status !== 'unscheduled' || !t.inDate) return t;
      const hist = Array.isArray(t.statusHistory) ? t.statusHistory : [];
      // 他ボード由来のカードは曜日振り分けしない（別の復旧ボタンで対応）
      if (hist.some(h => h && h.status && !PLANNING_STATUSES.has(h.status))) return t;
      const d = new Date(t.inDate);
      if (Number.isNaN(d.getTime())) return t;
      const dayStatus = dayNames[d.getDay()];
      if (!dayStatus) return t;
      const updated = transitionTaskStatus(t, dayStatus, { ...t, status: dayStatus });
      if (isFirebaseConfigured()) upsertDocument('boards/main/tasks', updated.id, updated).catch(() => {});
      return updated;
    }));
    showSettingsToast(`入庫予約の${unscheduledWithInDate.length}件を曜日列へ振り分けました`);
  };

  const restoreUnscheduledToPreviousColumn = () => {
    if (unscheduledFromOtherBoard.length === 0) return;
    const msg = `他ボードから入庫日未定に来たカード ${unscheduledFromOtherBoard.length} 件を、直前の工程（鈑金・塗装・納車完了など）に戻します。よろしいですか？`;
    if (!window.confirm(msg)) return;
    setTasks(prev => prev.map(t => {
      if (!t || t.status !== 'unscheduled') return t;
      const hist = Array.isArray(t.statusHistory) ? t.statusHistory : [];
      if (hist.length === 0) return t;
      // 全履歴を逆順で走査し、最も新しい非planningステータスを復元先にする
      const restoreEntry = [...hist].reverse().find(h => h && h.status && !PLANNING_STATUSES.has(h.status));
      if (!restoreEntry) return t;
      const restoreStatus = restoreEntry.status;
      const updated = transitionTaskStatus(t, restoreStatus);
      if (isFirebaseConfigured()) upsertDocument('boards/main/tasks', updated.id, updated).catch(() => {});
      return updated;
    }));
    showSettingsToast(`他ボードから来た${unscheduledFromOtherBoard.length}件を直前の工程に戻しました`);
  };

  // 入庫日未定にある全カード（履歴が壊れているカードも含む手動復旧用）
  const allUnscheduledTasks = useMemo(() => {
    return tasks.filter(t => t && t.status === 'unscheduled');
  }, [tasks]);
  const [showUnscheduledRecovery, setShowUnscheduledRecovery] = useState(false);
  const [unscheduledRecoverySelection, setUnscheduledRecoverySelection] = useState({});

  const allColumnOptions = useMemo(() => {
    const opts = [];
    BOARD_ORDER.forEach(bid => {
      const cols = getColumnsForBoard(boardColumnsConfig, bid);
      (cols || []).forEach(col => {
        const primary = getColumnPrimaryStatusForBoard(bid, col);
        opts.push({ boardId: bid, col, primaryStatus: primary, label: `${getBoardTitle(bid, useIndonesian)} > ${getColumnName(col, useIndonesian)}` });
      });
    });
    return opts;
  }, [boardColumnsConfig, columnStatuses, useIndonesian]);

  const getPreviousStatus = (task) => {
    const history = Array.isArray(task.statusHistory) ? task.statusHistory : [];
    if (!history.length) return 'delivery_wait';
    const last = history[history.length - 1];
    return last && last.status ? last.status : 'delivery_wait';
  };

  const moveTaskWithinStatus = (taskId, direction) => {
    const idxChange = direction === 'up' ? -1 : 1;
    const getOrder = (t) => (typeof t.order === 'number' ? t.order : null);
    setTasks((prev) => {
      const target = prev.find((t) => t.id === taskId);
      if (!target || !target.status) return prev;
      const sameStatus = prev
        .filter((t) => t.status === target.status)
        .slice()
        .sort((a, b) => {
          const oa = getOrder(a);
          const ob = getOrder(b);
          if (oa != null && ob != null) return oa - ob;
          if (oa != null) return -1;
          if (ob != null) return 1;
          return 0;
        });
      const currentIndex = sameStatus.findIndex((t) => t.id === taskId);
      if (currentIndex === -1) return prev;
      const targetIndex = currentIndex + idxChange;
      if (targetIndex < 0 || targetIndex >= sameStatus.length) return prev;
      const reordered = sameStatus.slice();
      const [moved] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, moved);
      reordered.forEach((t, index) => {
        t.order = index;
      });
      if (isFirebaseConfigured()) {
        reordered.forEach((t) => {
          upsertDocument('boards/main/tasks', t.id, t).catch(() => {});
        });
      }
      const byId = new Map(reordered.map((t) => [t.id, t]));
      return prev.map((t) => (byId.has(t.id) ? { ...t, order: byId.get(t.id).order } : t));
    });
  };

  const transitionTaskStatus = (task, newStatus, extra = {}) => {
    const operatorName =
      (extra && typeof extra._operatorName === 'string' && extra._operatorName) ||
      (currentUser && String(currentUser)) ||
      null;
    return transitionTaskStatusWithOperator(task, newStatus, extra, operatorName);
  };

  const handleDragStart = (e, id) => {
    if (isDragOnly) return;
    setDraggedTaskId(id);
    setIsCardDragActive(true);
    // 列移動 + 目安箱コピーの両方を許可
    e.dataTransfer.effectAllowed = 'copyMove';
    // ドラッグキャンセル時（Esc・画面外等）に状態を確実にクリアする
    const cleanup = () => {
      setDraggedTaskId((prev) => prev === id ? null : prev);
      setIsCardDragActive(false);
      setIsMailboxDragOver(false);
      e.target.removeEventListener('dragend', cleanup);
    };
    e.target.addEventListener('dragend', cleanup);
  };
  const handleDragOver = (e) => { e.preventDefault(); if (!isDragOnly) e.dataTransfer.dropEffect = 'move'; };
  const handleDrop = (e, col) => {
    e.preventDefault();
    if (isDragOnly || !draggedTaskId) return;
    const status = getColumnPrimaryStatus(col);
    if (!status) { setDraggedTaskId(null); return; }
    const currentTask = tasks.find(t => t.id === draggedTaskId);
    if (!currentTask) {
      setDraggedTaskId(null);
      return;
    }
    // ボードスコープチェック: 現在のボードの列に属さないカードを別ボードの列に落とすことを防止
    // （例: 納車済みカードが入庫日未定に移動するケースを防ぐ）
    const currentBoardCols = getColumnsForBoard(boardColumnsConfig, currentBoardId);
    const currentBoardAllStatuses = new Set();
    (currentBoardCols || []).forEach(c => {
      const sts = getColumnStatuses(c);
      if (Array.isArray(sts)) sts.forEach(s => currentBoardAllStatuses.add(s));
    });
    if (!currentBoardAllStatuses.has(currentTask.status)) {
      // ドラッグ元カードが現在のボードに属していない → 安全のため移動しない
      setDraggedTaskId(null);
      return;
    }
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
    const base = status && status !== currentTask.status
      ? transitionTaskStatus(currentTask, status)
      : { ...currentTask };
    const updatedTask = newInDate ? { ...base, inDate: newInDate } : base;
    setTasks(prev => prev.map(t => (t.id === draggedTaskId ? updatedTask : t)));
    if (isFirebaseConfigured()) {
      upsertDocument('boards/main/tasks', updatedTask.id, updatedTask);
      if (shouldSyncToSheetOnStatusChange(currentTask.status, updatedTask.status)) {
        syncCardToSheet(updatedTask);
      }
      if (shouldSyncCycleTime(currentTask.status, updatedTask.status)) {
        syncCycleTimeToSheet(updatedTask);
      }
    }
    setDraggedTaskId(null);
  };

  const handleCreateTask = (newTask) => {
    const targetBoardId = currentView === 'gantt' ? 'planning' : currentBoardId;
    const cols = getColumnsForBoard(boardColumnsConfig, targetBoardId);
    const firstCol = cols[0];
    let initialStatus = (firstCol && getColumnPrimaryStatus(firstCol)) || 'unscheduled';
    if (targetBoardId === 'planning' && newTask.inDate) {
      const d = new Date(newTask.inDate);
      if (!Number.isNaN(d.getTime())) {
        const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const dayStatus = dayNames[d.getDay()];
        if (dayStatus) initialStatus = dayStatus;
      }
    }
    const newId = `t${Date.now()}`;
    const nowIso = new Date().toISOString();
    const taskWithId = {
      ...newTask,
      id: newId,
      status: initialStatus,
      statusEnteredAt: nowIso,
      statusHistory: [],
      attachments: Array.isArray(newTask.attachments) ? newTask.attachments : []
    };
    setTasks([...tasks, taskWithId]);
    if (isFirebaseConfigured()) {
      upsertDocument('boards/main/tasks', newId, taskWithId);
    }
    if (newTask.loanerCarId && newTask.inDate) {
      const resId = `res${Date.now()}`;
      const reservation = {
        id: resId,
        carId: newTask.loanerCarId,
        taskId: newId,
        taskName: `${newTask.assignee || '未設定'} ${newTask.car || '新規車両'}`,
        start: newTask.inDate,
        end: newTask.outDate || newTask.inDate,
        color: newTask.color || 'bg-blue-400'
      };
      setReservations(prev => [...prev, reservation]);
      if (isFirebaseConfigured()) {
        upsertDocument('boards/main/reservations', resId, reservation);
      }
    }
    setIsCreateModalOpen(false);
    setCurrentBoardId(targetBoardId);
    setCurrentView('board');
    // Googleスプレッドシートへ同期（VITE_SHEET_SYNC_URL が設定されている場合のみ）
    syncCardToSheet(taskWithId);
  };

  const handleReservationUpdate = (updatedRes) => {
    setReservations(prev => prev.map(r => r.id === updatedRes.id ? updatedRes : r));
    if (isFirebaseConfigured()) {
      upsertDocument('boards/main/reservations', updatedRes.id, updatedRes);
    }
    if (updatedRes.taskId) {
      setTasks(prev => prev.map(t => t.id === updatedRes.taskId ? { ...t, inDate: updatedRes.start, outDate: updatedRes.end, loanerCarId: updatedRes.carId } : t));
    }
  };

  const handleTaskUpdate = (updatedTask) => {
    const prevTask = tasks.find(t => t.id === updatedTask.id) || null;
    // setTasks 内で処理した結果を保持し、Firestore にも同じデータを書き込む
    let processedTask = null;
    setTasks(prev => prev.map(t => {
      if (t.id !== updatedTask.id) return t;
      // 入庫ボードでは、入庫日が入ったカードを「入庫日未定」のままにしないよう、曜日カラムへ自動で移動
      // ただし、他ボード由来のステータスを持つカードは巻き込まない
      const PLANNING_STATUSES_SET = new Set(['unscheduled', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'received']);
      if (currentBoardId === 'planning' && PLANNING_STATUSES_SET.has(t.status) && updatedTask.inDate && (!updatedTask.status || updatedTask.status === t.status)) {
        const d = new Date(updatedTask.inDate);
        if (!Number.isNaN(d.getTime())) {
          const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
          const nextStatus = dayNames[d.getDay()];
          if (nextStatus && nextStatus !== t.status) {
            const merged = { ...t, ...updatedTask, status: nextStatus };
            processedTask = transitionTaskStatus(t, nextStatus, merged);
            return processedTask;
          }
        }
      }
      // ステータスが変わる場合は滞在時間を履歴に追加しつつ更新
      if (updatedTask.status && updatedTask.status !== t.status) {
        processedTask = transitionTaskStatus(t, updatedTask.status, updatedTask);
        return processedTask;
      }
      // ステータスが変わらない場合はその他の項目だけ上書きし、履歴系は保持
      processedTask = {
        ...t,
        ...updatedTask,
        statusEnteredAt: t.statusEnteredAt,
        statusHistory: t.statusHistory
      };
      return processedTask;
    }));

    // Firestore には処理後の正しいデータを書き込む（ステータスや履歴がローカルと一致するようにする）
    const taskToSave = processedTask || updatedTask;

    // 代車情報とガントチャート予約の連動
    const hasLoaner =
      taskToSave.loanerType &&
      taskToSave.loanerType !== 'none' &&
      taskToSave.loanerCarId &&
      taskToSave.inDate;

    setReservations(prev => {
      const current = prev.filter(r => r.taskId === taskToSave.id);
      const others = prev.filter(r => r.taskId !== taskToSave.id);

      // 代車なしに変更された場合は予約を削除
      if (!hasLoaner) {
        if (isFirebaseConfigured()) {
          current.forEach(r => {
            deleteDocument('boards/main/reservations', r.id).catch(() => {});
          });
        }
        return others;
      }

      const baseId = current[0]?.id || `res${Date.now()}`;
      const reservation = {
        id: baseId,
        carId: taskToSave.loanerCarId,
        taskId: taskToSave.id,
        taskName: `${taskToSave.assignee || '未設定'} ${taskToSave.car || '新規車両'}`.trim(),
        start: taskToSave.inDate,
        end: taskToSave.outDate || taskToSave.inDate,
        color: taskToSave.color || 'bg-blue-400'
      };

      if (isFirebaseConfigured()) {
        upsertDocument('boards/main/reservations', baseId, reservation).catch(() => {});
      }

      return [...others, reservation];
    });

    if (isFirebaseConfigured()) {
      upsertDocument('boards/main/tasks', taskToSave.id, taskToSave);
      if (prevTask && shouldSyncToSheetOnStatusChange(prevTask.status, taskToSave.status)) {
        syncCardToSheet(taskToSave);
      }
      if (prevTask && shouldSyncCycleTime(prevTask.status, taskToSave.status)) {
        syncCycleTimeToSheet(taskToSave);
      }
    }
  };

  const switchBoard = (boardId) => {
    setCurrentBoardId(boardId);
    setSelectedTaskId(null);
    setDraggedTaskId(null);
    setIsHeaderMenuOpen(false);
    setIsProjectMenuOpen(false);
    setCurrentView('board');
  };

  return (
    <div className="flex flex-col min-h-[100dvh] h-screen bg-gray-100 font-sans text-gray-800 overflow-hidden relative" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {calendarToast && (
        <div className="absolute left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium shadow-lg animate-fade-in" style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}>
          {calendarToast}
        </div>
      )}
      {settingsSaveToast && (
        <div className="absolute left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-lg animate-fade-in" style={{ top: 'calc(3.5rem + env(safe-area-inset-top))' }}>
          {settingsSaveToast}
        </div>
      )}
      <header className="bg-white border-b border-gray-200 flex items-center justify-between gap-2 px-2 sm:px-4 py-2 shadow-sm z-30 min-h-[3rem]" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <div className="flex-1 min-w-0 flex items-center justify-start">
          <button
            type="button"
            onClick={toggleIndonesian}
            className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs sm:text-sm font-medium transition shrink-0 ${useIndonesian ? 'bg-amber-100 text-amber-800' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'}`}
            title={useIndonesian ? '日本語に切り替え（列・ボード名）' : '列名・ボード名をインドネシア語で表示'}
          >
            <span aria-hidden>🇮🇩</span>
            <span className="hidden sm:inline">{useIndonesian ? 'Bahasa Indonesia ON' : 'Bahasa Indonesia'}</span>
          </button>
        </div>
        <div className="flex items-center gap-1 sm:gap-3 justify-center relative min-w-0 flex-shrink" ref={headerMenuRef}>
          <h1 className="text-sm sm:text-lg font-bold text-gray-800 truncate hidden sm:block" style={{ maxWidth: '8rem' }}>{APP_NAME}</h1>
          <h1 className="text-sm font-bold text-gray-800 truncate sm:hidden" style={{ maxWidth: '2.5rem' }}>BB</h1>
          <button
            type="button"
            onClick={() => setIsHeaderMenuOpen(!isHeaderMenuOpen)}
            className={`text-xs sm:text-sm font-medium rounded px-1.5 sm:px-2 py-1.5 transition-colors flex items-center gap-0.5 sm:gap-1 shrink-0 ${isHeaderMenuOpen ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
            title="ボードを切り替え"
          >
            <span className="hidden sm:inline truncate max-w-[200px]">{currentView === 'board' ? getBoardTitle(currentBoardId, useIndonesian) : (useIndonesian ? 'Peminjaman Kendaraan' : '代車・レンタカー 貸出状況')}</span>
            <span className="sm:hidden">{currentView === 'board' ? 'ボード' : '代車'}</span>
            {currentView === 'board' && currentBoardId === 'main' && <ChevronDown className="w-4 h-4 flex-shrink-0" />}
          </button>
          {!isViewOnly && <Button onClick={() => setIsCreateModalOpen(true)} className="!px-2 sm:!px-3 !py-1.5 !text-xs sm:!text-sm shrink-0"><span className="hidden sm:inline">カード作成</span><span className="sm:hidden">作成</span></Button>}
          <button type="button" onClick={() => setIsCalendarLinkModalOpen(true)} className="p-1.5 sm:p-2 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 flex-shrink-0" title="Googleカレンダーから入庫予定作成">
            <Calendar className="w-5 h-5" />
          </button>
          {isHeaderMenuOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-80 bg-white border border-gray-200 shadow-xl rounded-md py-2 z-50">
              {BOARD_ORDER.map(id => BOARDS[id]).filter(Boolean).map(board => (
                <button key={board.id} onClick={() => switchBoard(board.id)} className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${currentBoardId === board.id && currentView === 'board' ? 'border-l-2 border-blue-500 bg-blue-50 text-blue-700' : 'text-gray-700'}`}>
                  {getBoardTitle(board.id, useIndonesian)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 flex items-center justify-end gap-1 sm:gap-3 min-w-0 flex-shrink-0">
          <a href={(import.meta.env.VITE_BB_SEIBI_URL || '/seibi/')} className="p-1.5 sm:p-2 rounded text-blue-500 hover:text-blue-700 hover:bg-blue-50 flex-shrink-0 flex items-center gap-1" title="BB 整備">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /><path d="m15 9-6 6m0-6 6 6" /></svg>
            <span className="hidden sm:inline text-xs font-medium">整備</span>
          </a>
          <button
            type="button"
            onClick={() => setIsSendNotificationOpen(true)}
            onDragOver={(e) => {
              if (!isCardDragActive) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDragEnter={(e) => {
              if (!isCardDragActive) return;
              e.preventDefault();
              setIsMailboxDragOver(true);
            }}
            onDragLeave={() => setIsMailboxDragOver(false)}
            onDrop={(e) => {
              if (!isCardDragActive || !draggedTaskId) return;
              e.preventDefault();
              e.stopPropagation();
              const task = tasks.find((t) => t.id === draggedTaskId) || null;
              setIsMailboxDragOver(false);
              if (task) {
                setIncidentReportTask(task);
                setIsIncidentReportOpen(true);
              }
              // カードのonDragEndで draggedTaskId / isCardDragActive はクリアされる
            }}
            className={`p-1.5 sm:p-2 rounded flex-shrink-0 transition ${
              isMailboxDragOver
                ? 'text-amber-700 bg-amber-100 ring-2 ring-amber-500 ring-offset-1 scale-110'
                : isCardDragActive
                  ? 'text-amber-600 bg-amber-50 ring-2 ring-amber-300 animate-pulse'
                  : 'text-gray-500 hover:text-gray-700'
            }`}
            title={isCardDragActive ? 'カードをドロップして不具合通知' : '通知を送る'}
          >
            <Mailbox className="w-5 h-5" />
          </button>
          <div className="relative flex-shrink-0" ref={notificationPanelRef}>
            <button type="button" onClick={() => setIsNotificationPanelOpen((v) => !v)} className="p-1.5 sm:p-2 rounded text-gray-500 hover:text-gray-700 flex-shrink-0 relative" title={(() => { const u = (notifications || []).filter((n) => !n.read).length; return u > 0 ? `通知（未読${u}件）` : '通知'; })()}>
              <Bell className="w-5 h-5" />
              {(() => {
                const unreadCount = (notifications || []).filter((n) => !n.read).length;
                if (unreadCount <= 0) return null;
                return (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold ring-2 ring-white" aria-label={`未読${unreadCount}件`}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                );
              })()}
            </button>
            {isNotificationPanelOpen && (
              <div className="absolute top-full right-0 mt-1 w-80 max-h-[70vh] bg-white border border-gray-200 shadow-xl rounded-md overflow-hidden z-50 flex flex-col">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">通知</span>
                  {(notifications || []).filter((n) => !n.read).length > 0 && (
                    <span className="text-xs text-gray-500">開くと既読になります</span>
                  )}
                </div>
                <div className="overflow-y-auto flex-1 min-h-0">
                  {(notifications || []).length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-500">通知はありません</div>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {(notifications || []).map((n) => {
                        const isIncident = n.kind === 'incident_report' && n.cardSnapshot;
                        if (!isIncident) {
                          return (
                            <li key={n.id} className={`px-4 py-3 text-sm ${n.read ? 'bg-gray-50/50 text-gray-600' : 'bg-white'}`}>
                              <div className="font-medium text-gray-800">{n.fromUser || '（不明）'}</div>
                              <div className="mt-0.5 text-gray-700 whitespace-pre-wrap">{n.message || ''}</div>
                              <div className="mt-1 text-xs text-gray-400">{n.createdAt ? new Date(n.createdAt).toLocaleString('ja-JP') : ''}</div>
                            </li>
                          );
                        }
                        const snap = n.cardSnapshot || {};
                        const carLine = `${snap.maker || ''} ${snap.car || ''}`.trim();
                        return (
                          <li key={n.id} className={`px-4 py-3 text-sm ${n.read ? 'bg-gray-50/50 text-gray-600' : 'bg-white border-l-2 border-amber-500'}`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">不具合報告</span>
                              <span className="font-medium text-gray-800 text-sm">{n.fromUser || '（不明）'}</span>
                            </div>
                            <div className="rounded bg-gray-50 border border-gray-200 px-2 py-1.5 text-xs space-y-0.5">
                              <div><span className="text-gray-500">お客様: </span>{snap.assignee || '（未設定）'}</div>
                              <div><span className="text-gray-500">車両: </span>{carLine || '（未設定）'} {snap.number || ''}</div>
                              <div><span className="text-gray-500">現ステータス: </span>{snap.statusLabel || snap.status || '（不明）'}</div>
                              {snap.receptionStaff && (
                                <div><span className="text-gray-500">受付: </span>{snap.receptionStaff}</div>
                              )}
                            </div>
                            <div className="mt-1.5 text-gray-700 whitespace-pre-wrap text-sm">{n.message || ''}</div>
                            {Array.isArray(snap.recentStatusHistory) && snap.recentStatusHistory.length > 0 && (
                              <details className="mt-1.5 text-xs text-gray-600">
                                <summary className="cursor-pointer text-gray-500 hover:text-gray-700">直近のステータス履歴（{snap.recentStatusHistory.length}件）</summary>
                                <ul className="mt-1 space-y-0.5 pl-3">
                                  {snap.recentStatusHistory.map((h, i) => (
                                    <li key={i} className="text-[11px]">
                                      <span className="text-gray-700">{h.statusLabel || h.status || '?'}</span>
                                      {h.byUser && <span className="text-gray-400"> / {h.byUser}</span>}
                                      {h.exitedAt && <span className="text-gray-400"> ({new Date(h.exitedAt).toLocaleString('ja-JP')})</span>}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            <div className="mt-1 text-xs text-gray-400">{n.createdAt ? new Date(n.createdAt).toLocaleString('ja-JP') : ''}</div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="relative flex-shrink-0" ref={searchMenuRef}>
            <button onClick={() => setIsSearchMenuOpen(!isSearchMenuOpen)} className={`p-1.5 sm:px-3 sm:py-1.5 rounded flex items-center gap-1 ${isSearchMenuOpen ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100'} text-gray-700`} title="カード検索">
              <Search className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline">検索</span>
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 absolute -top-0.5 -right-0.5 sm:static sm:ml-0" />}
            </button>
            {isSearchMenuOpen && (
              <div className="absolute top-full right-0 mt-1 w-80 bg-white border border-gray-200 shadow-xl rounded-md p-4 z-50">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">カードで絞り込み</div>
                <div className="space-y-3 text-sm">
                  <div>
                    <label className="block text-gray-600 mb-1">顧客名</label>
                    <IMEInput placeholder="例: 杉村" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={searchFilters.assignee} onChange={(v) => setSearchFilters(f => ({ ...f, assignee: v }))} />
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
                    <IMEInput placeholder="例: ノート" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={searchFilters.car} onChange={(v) => setSearchFilters(f => ({ ...f, car: v }))} />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">受付担当者</label>
                    <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white" value={searchFilters.receptionStaff} onChange={(e) => setSearchFilters(f => ({ ...f, receptionStaff: e.target.value }))}>
                      <option value="">すべて</option>
                      {((staffOptionsConfig || getStaffOptionsConfig()).reception || []).filter(Boolean).map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">鈑金担当者</label>
                    <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white" value={searchFilters.bodyStaff} onChange={(e) => setSearchFilters(f => ({ ...f, bodyStaff: e.target.value }))}>
                      <option value="">すべて</option>
                      {((staffOptionsConfig || getStaffOptionsConfig()).body || []).filter(Boolean).map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">塗装担当者</label>
                    <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white" value={searchFilters.paintStaff} onChange={(e) => setSearchFilters(f => ({ ...f, paintStaff: e.target.value }))}>
                      <option value="">すべて</option>
                      {((staffOptionsConfig || getStaffOptionsConfig()).paint || []).filter(Boolean).map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">ナンバー（車番）</label>
                    <IMEInput placeholder="例: 501" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={searchFilters.number} onChange={(v) => setSearchFilters(f => ({ ...f, number: v }))} />
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

      <div className="flex flex-1 min-h-0 overflow-hidden relative z-0">
        <div className="w-12 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-6 z-10 shadow-sm flex-shrink-0">
          <div className="relative flex flex-col items-center" ref={accountMenuRef}>
            <button
              type="button"
              onClick={() => {
                if (isViewOnly) {
                  const url = new URL(window.location.href);
                  url.searchParams.set('forceLogin', '1');
                  window.location.href = url.toString();
                  return;
                }
                setIsAccountMenuOpen(!isAccountMenuOpen);
              }}
              className="group relative flex flex-col items-center w-full rounded hover:bg-gray-50 focus:outline-none"
              title={isViewOnly ? 'ログインする' : 'アカウント'}
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-500 shadow-sm border-2 border-white flex-shrink-0" aria-hidden />
            </button>
            {isAccountMenuOpen && typeof onLogout === 'function' && (
              <div className="absolute left-full top-0 ml-2 w-36 bg-white border border-gray-200 shadow-lg rounded-md py-1 z-50">
                <button type="button" onClick={() => { onLogout(); setIsAccountMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                  ログアウト
                </button>
              </div>
            )}
          </div>
          <Layout onClick={() => setCurrentView('board')} className={`w-6 h-6 cursor-pointer transition-colors ${currentView === 'board' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`} title="カンバンボード" />
          <Car onClick={() => setCurrentView('gantt')} className={`w-6 h-6 cursor-pointer transition-colors ${currentView === 'gantt' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`} title="代車・レンタカー貸出表" />
          <button type="button" onClick={() => setIsCalendarLinkModalOpen(true)} className="p-0.5 text-gray-400 hover:text-gray-600 cursor-pointer" title="カレンダー用リンク（入庫→カード作成）">
            <Calendar className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => window.open(`${import.meta.env.BASE_URL}estimator/見積もりチェッカー2.html?${new URLSearchParams({ 担当者: currentUser || '' }).toString()}`, '_blank', 'noopener,noreferrer')} className="p-0.5 text-gray-400 hover:text-gray-600 cursor-pointer" title="見積もり漏れチェッカー（担当者に受付担当者を反映）">
            <FileText className="w-5 h-5" />
          </button>
          <History onClick={() => setIsChangelogOpen(true)} className="w-5 h-5 text-gray-400 hover:text-gray-600 cursor-pointer mt-auto" title="更新履歴" />
          {!isViewOnly && <Settings onClick={() => setIsSettingsOpen(true)} className="w-5 h-5 text-gray-400 hover:text-gray-600 cursor-pointer" title="設定" />}
        </div>

        <div className="flex-1 flex overflow-hidden bg-white min-h-0">
          {currentView === 'gantt' ? (
            <LoanerGanttChart
              fleetCars={fleetCars}
              setFleetCars={setFleetCars}
              reservations={reservations}
              setReservations={setReservations}
              onReservationUpdate={handleReservationUpdate}
              setTasks={setTasks}
              tasks={tasks}
              rentalCompanies={rentalCompanies}
              onSelectTask={(id) => setSelectedTaskId(id)}
              viewOnly={isDragOnly}
            />
          ) : currentView === 'history' ? (
            <div className="flex-1 min-h-0 p-4 bg-white overflow-y-auto">
              <h2 className="text-lg font-bold text-gray-800 mb-3">カード移動履歴</h2>
              <p className="text-sm text-gray-500 mb-4">
                すべてのカードのステータス変更履歴です。新しい順に最大 500 件まで表示します。
              </p>
              {historyEntries.length === 0 ? (
                <p className="text-sm text-gray-600">まだ履歴はありません。</p>
              ) : (
                <div className="space-y-2 max-h-full overflow-y-auto">
                  {historyEntries.slice(0, 500).map((h) => {
                    const fromLabel =
                      h.fromStatus &&
                      allColumnOptions.find((opt) => opt.primaryStatus === h.fromStatus)?.label;
                    const toLabel =
                      h.toStatus &&
                      allColumnOptions.find((opt) => opt.primaryStatus === h.toStatus)?.label;
                    const rawTime = h.exitedAt || h.enteredAt || '';
                    const timeLabel = rawTime ? (() => {
                      try {
                        const d = new Date(rawTime);
                        if (Number.isNaN(d.getTime())) return rawTime;
                        return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                      } catch { return rawTime; }
                    })() : '';
                    return (
                      <div
                        key={h.id}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-xs sm:text-sm text-gray-800 bg-white"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">
                            {h.taskLabel}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            {timeLabel}
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] sm:text-xs text-gray-600">
                          <span>
                            {fromLabel || h.fromStatus || '不明'} → {toLabel || h.toStatus || '不明'}
                          </span>
                          {h.byUser && (
                            <span className="ml-2 text-gray-500">
                              （操作: {h.byUser}）
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className={`flex flex-col overflow-hidden min-h-0 transition-all duration-300 ${selectedTaskId && !isNfcMode ? 'w-[calc(100%-450px)] border-r border-gray-200' : 'w-full'}`}>
                <div className="flex-1 min-h-0 p-4 pt-4 bg-white overflow-x-auto overflow-y-auto flex flex-col gap-3">
                  {isNfcMode && (
                    <div className="flex-shrink-0 w-full px-4 py-3 rounded-md bg-amber-50 border border-amber-200 flex flex-col gap-2 text-xl text-gray-800">
                      {selectedTask ? (
                        <>
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-4 min-w-0">
                              <span className="font-semibold text-amber-900 whitespace-nowrap text-2xl">NFCモード: 列を選んで移動</span>
                              <span className="px-3 py-1.5 rounded-full bg-white border border-amber-200 text-base text-amber-700">
                                {selectedTask.assignee} / {selectedTask.car} {selectedTask.number}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xl text-gray-800 font-semibold">{useIndonesian ? 'Papan Tujuan:' : '対象ボード:'}</span>
                              <select
                                className="border border-amber-300 rounded px-4 py-2.5 bg-white text-xl font-medium"
                                value={nfcBoardId}
                                onChange={(e) => setNfcBoardId(e.target.value === 'paint' ? 'paint' : 'body')}
                              >
                                <option value="body">{useIndonesian ? 'Bodyshop' : '鈑金ボード'}</option>
                                <option value="paint">{useIndonesian ? 'Paint' : '塗装ボード'}</option>
                              </select>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-4">
                            <span className="text-xl text-gray-900 font-semibold">
                              {useIndonesian ? 'Kolom Saat Ini:' : '現在の列:'}{' '}
                              <span className="text-xl text-blue-700 font-semibold">
                                {(() => { const c = boardColumns.find(col => getColumnStatuses(col).includes(selectedTask.status)); return c ? getColumnName(c, useIndonesian) : (useIndonesian ? 'Tidak dapat menentukan' : '判別できません'); })()}
                              </span>
                            </span>
                            <div className="flex items-center gap-3">
                              <span className="text-xl text-gray-900 font-semibold">{useIndonesian ? 'Tujuan:' : '移動先:'}</span>
                              <select
                                className="border border-amber-300 rounded px-4 py-3 bg-white text-xl font-medium"
                                defaultValue=""
                                onChange={(e) => {
                                  const colId = e.target.value;
                                  if (!colId) return;
                                  const col = nfcBoardColumns.find(c => c.id === colId);
                                  if (!col) return;
                                  const primaryStatus = getColumnPrimaryStatus(col);
                                  if (!primaryStatus || primaryStatus === selectedTask.status) return;
                                  handleTaskUpdate({ ...selectedTask, status: primaryStatus });
                                  e.target.value = '';
                                }}
                              >
                                <option value="">{useIndonesian ? 'Pilih kolom' : '列を選択'}</option>
                                {nfcBoardColumns.map(col => (
                                  <option key={col.id} value={col.id}>
                                    {getColumnName(col, useIndonesian)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-base text-red-700">
                          このNFCタグに対応するカードが見つかりませんでした。カードが削除されていないか確認してください。
                        </div>
                      )}
                    </div>
                  )}
                  {showAnomalyBanner && anomalousReceivedTasks.length > 0 && (
                    <div className="flex-shrink-0 flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-sm">
                      <div className="flex items-center gap-2 text-red-800">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span>後工程にいたカードが「入庫済み」に戻っています（{anomalousReceivedTasks.length}件）。設定画面の「データ復旧」から一括復元できます。</span>
                      </div>
                      <button type="button" onClick={() => setShowAnomalyBanner(false)} className="text-red-400 hover:text-red-600 flex-shrink-0 text-xs">✕ 閉じる</button>
                    </div>
                  )}
                  {currentBoardId === 'planning' && allUnscheduledTasks.length > 0 && (
                    <div className="flex-shrink-0 flex flex-col gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-sm">
                      <p className="text-amber-800">
                        入庫日未定に {allUnscheduledTasks.length} 件のカードがあります。
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {unscheduledFromOtherBoard.length > 0 && (
                          <button
                            type="button"
                            onClick={restoreUnscheduledToPreviousColumn}
                            className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                          >
                            他ボードから来たカードを直前の工程に戻す（{unscheduledFromOtherBoard.length}件）
                          </button>
                        )}
                        {unscheduledWithInDate.length > 0 && (
                          <button
                            type="button"
                            onClick={redistributeUnscheduledByInDate}
                            className="px-3 py-1.5 rounded bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
                          >
                            入庫日に合わせて曜日列へ振り分け（{unscheduledWithInDate.length}件）
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowUnscheduledRecovery(!showUnscheduledRecovery)}
                          className="px-3 py-1.5 rounded bg-gray-700 text-white text-sm font-medium hover:bg-gray-800"
                        >
                          {showUnscheduledRecovery ? '一覧を閉じる' : `全カード一覧から手動復旧（${allUnscheduledTasks.length}件）`}
                        </button>
                      </div>
                      {showUnscheduledRecovery && (
                        <div className="mt-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
                          {allUnscheduledTasks.map(task => {
                            const hist = Array.isArray(task.statusHistory) ? task.statusHistory : [];
                            const lastNonPlanning = [...hist].reverse().find(h => h && h.status && !PLANNING_STATUSES.has(h.status));
                            const selectedStatus = unscheduledRecoverySelection[task.id] ?? (lastNonPlanning ? lastNonPlanning.status : allColumnOptions[0]?.primaryStatus ?? '');
                            return (
                              <div key={task.id} className="px-3 py-2 flex flex-wrap items-center gap-2">
                                <div className="flex-1 min-w-[180px]">
                                  <span className="font-medium text-gray-800">{task.assignee || '（未設定）'}</span>
                                  <span className="text-gray-500 ml-1">{task.car || ''} {task.number || ''}</span>
                                  {lastNonPlanning && <span className="text-xs text-blue-600 ml-2">元: {lastNonPlanning.status}</span>}
                                  {!lastNonPlanning && hist.length === 0 && <span className="text-xs text-gray-400 ml-2">履歴なし</span>}
                                </div>
                                <select
                                  className="border border-gray-300 rounded px-2 py-1 text-xs bg-white min-w-[180px]"
                                  value={selectedStatus}
                                  onChange={(e) => setUnscheduledRecoverySelection(prev => ({ ...prev, [task.id]: e.target.value }))}
                                >
                                  {allColumnOptions.map((opt, i) => (
                                    <option key={i} value={opt.primaryStatus}>{opt.label}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const status = unscheduledRecoverySelection[task.id] ?? (lastNonPlanning ? lastNonPlanning.status : allColumnOptions[0]?.primaryStatus);
                                    if (!status) return;
                                    handleTaskUpdate({ ...task, status });
                                    setUnscheduledRecoverySelection(prev => { const next = { ...prev }; delete next[task.id]; return next; });
                                  }}
                                  className="px-2 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 flex-shrink-0"
                                >
                                  移動
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2 h-full min-h-0 w-full min-w-0 flex-1 overflow-x-auto">
                    {boardColumns.map(col => {
                      const columnStatuses = getColumnStatuses(col);
                      const rawColumnTasks = hideColumnCards(col.id)
                        ? []
                        : filteredTasks.filter(t => columnStatuses.includes(t.status));
                      const sortedTasks = rawColumnTasks.slice().sort((a, b) => {
                        const parse = (d) => {
                          if (!d) return null;
                          const dt = new Date(d);
                          return Number.isNaN(dt.getTime()) ? null : dt.getTime();
                        };
                        const getOrder = (t) => (typeof t.order === 'number' ? t.order : null);
                        const hasBlueDot = (task) =>
                          Array.isArray(task.dots) && task.dots.includes('blue');

                        const oa = getOrder(a);
                        const ob = getOrder(b);
                        if (oa != null && ob != null) return oa - ob;
                        if (oa != null) return -1;
                        if (ob != null) return 1;

                        // 納車ボードでは、青ドット優先 → 納車日(outDate)昇順 → 納車日なしを下
                        if (currentBoardId === 'delivery') {
                          const blueA = hasBlueDot(a);
                          const blueB = hasBlueDot(b);
                          if (blueA !== blueB) return blueB ? 1 : -1; // true を上に

                          const da = parse(a.outDate);
                          const db = parse(b.outDate);
                          if (da != null && db != null) return da - db; // 早い日付を上
                          if (da != null) return -1; // 日付ありを上
                          if (db != null) return 1;
                          return 0;
                        }

                        // それ以外のボードは従来どおり
                        const da = parse(a.outDate) ?? parse(a.inDate);
                        const db = parse(b.outDate) ?? parse(b.inDate);
                        if (da != null && db != null) return da - db;
                        if (da != null) return -1;
                        if (db != null) return 1;
                        return 0;
                      });
                      const totalCount = sortedTasks.length;
                      return (
                        <div
                          key={col.id}
                          style={{ minWidth: `${columnMinWidth}px` }}
                          className={`flex flex-col rounded-md border border-gray-200 flex-shrink-0 ${currentBoardId === 'planning' ? 'bg-gray-400' : 'bg-gray-50'}`}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, col)}
                        >
                          <div className={`p-3 font-semibold flex justify-between items-center text-sm border-b border-gray-200 rounded-t-md ${currentBoardId === 'planning' ? 'bg-white text-gray-800' : 'bg-gray-100 text-gray-700'}`}>
                            <div className="truncate pr-2" title={getColumnName(col, useIndonesian)}>{getColumnName(col, useIndonesian)}</div>
                            <div className={`text-xs px-1.5 py-0.5 rounded-full border ${currentBoardId === 'planning' ? 'bg-gray-100 text-gray-600 border-gray-300' : 'bg-white text-gray-500 border-gray-200'}`}>
                              {totalCount}
                            </div>
                          </div>
                          <div className="flex-1 p-2 space-y-2 min-h-[100px]">
                            {enableWeekGrouping ? (
                              (() => {
                                const groupsMap = {};
                                sortedTasks.forEach(task => {
                                  const info = getWeekInfo(getTaskDateForGrouping(task));
                                  const key = info ? info.key : 'no-date';
                                  if (!groupsMap[key]) groupsMap[key] = { info, tasks: [] };
                                  groupsMap[key].tasks.push(task);
                                });
                                const groups = Object.values(groupsMap).sort((a, b) => {
                                  if (!a.info && !b.info) return 0;
                                  if (!a.info) return 1;
                                  if (!b.info) return -1;
                                  return a.info.start - b.info.start;
                                });
                                return groups.map(group => {
                                  const weekKey = group.info ? group.info.key : 'no-date';
                                  const isCollapsed = !!(collapsedWeeks[col.id] && collapsedWeeks[col.id][weekKey]);
                                  const toggle = () => {
                                    setCollapsedWeeks(prev => {
                                      const prevCol = prev[col.id] || {};
                                      return {
                                        ...prev,
                                        [col.id]: { ...prevCol, [weekKey]: !prevCol[weekKey] }
                                      };
                                    });
                                  };
                                  const label = group.info ? group.info.label : '日付未設定';
                                  return (
                                    <div key={weekKey} className="mb-2 border border-gray-200 rounded-md bg-white/60">
                                      <button
                                        type="button"
                                        onClick={toggle}
                                        className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-t-md"
                                      >
                                        <span className="truncate">{label}</span>
                                        <span className="flex items-center gap-1">
                                          <span className="text-[11px] text-gray-500">{group.tasks.length}件</span>
                                          <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                                        </span>
                                      </button>
                                      {!isCollapsed && (
                                        <div className="p-1.5 space-y-1.5">
                                          {group.tasks.map(renderTaskCard)}
                                        </div>
                                      )}
                                    </div>
                                  );
                                });
                              })()
                            ) : (
                              sortedTasks.map(renderTaskCard)
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {currentBoardId === 'delivery' && deliveryCompletedTasks.length > 0 && (
                <div className="mt-4 bg-white rounded-md border border-gray-200 p-3 flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
                  <div className="flex items-center justify-between mb-2 flex-shrink-0">
                    <div className="text-sm font-semibold text-gray-800">納車完了履歴</div>
                    <div className="text-xs text-gray-500">{deliveryCompletedTasks.length}件{deliveryHistorySearch.trim() && ` → ${deliveryHistoryFiltered.length}件`}</div>
                  </div>
                  <div className="mb-2 flex-shrink-0">
                    <IMEInput
                      className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs bg-gray-50 focus:bg-white focus:border-blue-400 focus:outline-none"
                      placeholder="ナンバー・車種・お客様名で検索"
                      value={deliveryHistorySearch}
                      onChange={(v) => setDeliveryHistorySearch(v)}
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto min-h-0">
                    {deliveryHistoryByMonth.map((group) => {
                      const isCollapsed = !!collapsedMonths[group.key];
                      return (
                        <div key={group.key} className="mb-1">
                          <button
                            type="button"
                            onClick={() => setCollapsedMonths(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
                            className="w-full flex items-center justify-between px-2 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs font-semibold text-gray-700 sticky top-0 z-[1]"
                          >
                            <span>{group.key}（{group.tasks.length}件）</span>
                            <span className="text-gray-400">{isCollapsed ? '▶' : '▼'}</span>
                          </button>
                          {!isCollapsed && (
                            <div className="divide-y divide-gray-100">
                              {group.tasks.map((task) => (
                                <div
                                  key={task.id}
                                  className="w-full px-2 py-1.5 hover:bg-gray-50 flex items-center gap-2 text-xs"
                                >
                                  <button
                                    type="button"
                                    onClick={() => setSelectedTaskId(task.id)}
                                    className="flex-1 min-w-0 text-left flex items-center gap-2"
                                  >
                                    <span className="inline-flex items-center justify-center w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                                    <span className="flex-1 min-w-0 truncate" title={`${task.assignee || ''} ${task.car || ''} ${task.number || ''}`.trim()}>
                                      {(task.assignee || '').trim() || '担当未設定'} / {(task.car || '').trim() || '車種未設定'} {task.number || ''}
                                    </span>
                                    <span className="text-[11px] text-gray-500 flex-shrink-0">
                                      {task.outDate || task.inDate || ''}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (window.confirm('このカードを完了にする前にいた列へ戻します。よろしいですか？')) {
                                        restoreFromDeliveryHistory(task.id);
                                      }
                                    }}
                                    className="ml-2 px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-100 flex-shrink-0"
                                  >
                                    元に戻す
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {deliveryHistoryFiltered.length === 0 && deliveryHistorySearch.trim() && (
                      <p className="text-xs text-gray-500 py-3 text-center">該当する履歴はありません</p>
                    )}
                  </div>
                </div>
              )}

              {selectedTaskId && !isNfcMode && (
                <div className="w-[450px] flex-shrink-0 bg-white flex flex-col h-full overflow-hidden shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.1)] z-20">
                  <TaskDetailPanel
                    task={selectedTask}
                    fleetCars={fleetCars}
                    rentalCompanies={rentalCompanies}
                    defaultReceptionStaff={currentUser}
                    staffOptionsConfig={staffOptionsConfig}
                    onClose={() => setSelectedTaskId(null)}
                    onUpdate={handleTaskUpdate}
                    onMasterDelete={handleMasterDeleteTask}
                    currentBoardId={currentBoardId}
                    boardColumns={boardColumns}
                    getColumnStatuses={getColumnStatuses}
                    getColumnPrimaryStatus={getColumnPrimaryStatus}
                    moveTargetOptions={allColumnOptions}
                    useIndonesian={useIndonesian}
                    viewOnly={isViewOnly}
                    usedBinderNumbers={new Set(tasks.filter(t => t.id !== selectedTask?.id && t.binderNumber).map(t => t.binderNumber))}
                    currentUser={currentUser}
                    currentUserEmail={currentUserEmail}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {isCreateModalOpen && (
        <CreateTaskModal
          variant={currentView === 'gantt' ? 'side' : 'center'}
          fleetCars={fleetCars}
          rentalCompanies={rentalCompanies}
          defaultReceptionStaff={currentUser}
          staffOptionsConfig={staffOptionsConfig}
          onClose={() => setIsCreateModalOpen(false)}
          onSubmit={handleCreateTask}
        />
      )}
      {isCalendarLinkModalOpen && <CalendarLinkModal onClose={() => setIsCalendarLinkModalOpen(false)} />}
      {isSendNotificationOpen && (
        <SendNotificationModal
          onClose={() => setIsSendNotificationOpen(false)}
          currentUser={currentUser}
          currentUserEmail={currentUserEmail}
          allowedEmails={getAllowedEmails() || []}
          pastLoginUsers={pastLoginUsers}
        />
      )}
      {isIncidentReportOpen && incidentReportTask && (
        <IncidentReportModal
          task={incidentReportTask}
          onClose={() => { setIsIncidentReportOpen(false); setIncidentReportTask(null); }}
          onSent={(info) => setIncidentToast(info)}
          currentUser={currentUser}
          currentUserEmail={currentUserEmail}
          boardColumnsConfig={boardColumnsConfig}
          useIndonesian={useIndonesian}
        />
      )}
      {incidentToast && (
        <div className="fixed bottom-6 right-6 z-[60] pointer-events-none">
          <div className="bg-green-600 text-white px-5 py-3 rounded-lg shadow-2xl flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">不具合通知を送信しました — {incidentToast.label}</span>
          </div>
        </div>
      )}

      {isChangelogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setIsChangelogOpen(false)} aria-hidden />
          <div className="relative w-full max-w-lg bg-white rounded-xl shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold text-gray-800">更新履歴</h2>
              </div>
              <button type="button" onClick={() => setIsChangelogOpen(false)} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">
              {CHANGELOG.map((release) => (
                <div key={release.version}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">{release.version}</span>
                    <span className="text-sm text-gray-500">{release.date}</span>
                  </div>
                  <ul className="space-y-1 ml-1">
                    {release.items.map((item, i) => (
                      <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                        <span className="text-blue-400 mt-1 flex-shrink-0">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-gray-200 text-center">
              <span className="text-xs text-gray-400">BrightBoard by WBT</span>
            </div>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => { setIsSettingsOpen(false); setIsLinkSettingsOpen(false); setIsFleetSettingsOpen(false); setIsRentalCompaniesSettingsOpen(false); setIsColumnEditOpen(false); setIsStaffOptionsOpen(false); setIsInvoiceSettingsOpen(false); }}
            aria-hidden
          />
          <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">
                {isInvoiceSettingsOpen ? '請求書設定（インボイス）' : isLinkSettingsOpen ? 'ボード間リンク設定' : isFleetSettingsOpen ? '代車マスタ設定' : isRentalCompaniesSettingsOpen ? 'レンタル会社マスタ設定' : isColumnEditOpen ? '列の増減' : isStaffOptionsOpen ? '担当者一覧の編集' : '設定'}
              </h2>
              <button
                type="button"
                onClick={() => { setIsSettingsOpen(false); setIsLinkSettingsOpen(false); setIsFleetSettingsOpen(false); setIsRentalCompaniesSettingsOpen(false); setIsColumnEditOpen(false); setIsStaffOptionsOpen(false); setIsInvoiceSettingsOpen(false); }}
                className="p-1 rounded hover:bg-gray-100 text-gray-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {isInvoiceSettingsOpen ? (
                <InvoiceSettingsPanel
                  onBack={() => setIsInvoiceSettingsOpen(false)}
                />
              ) : isStaffOptionsOpen ? (
                <StaffOptionsPanel
                  staffOptionsConfig={staffOptionsConfig}
                  setStaffOptionsConfig={setStaffOptionsConfig}
                  onBack={() => setIsStaffOptionsOpen(false)}
                  onSave={handleSaveStaffOptions}
                />
              ) : isColumnEditOpen ? (
                <ColumnEditPanel
                  boardColumnsConfig={boardColumnsConfig}
                  setBoardColumnsConfig={setBoardColumnsConfig}
                  columnStatuses={columnStatuses}
                  setTasks={setTasks}
                  onBack={() => setIsColumnEditOpen(false)}
                />
              ) : isLinkSettingsOpen ? (
                <LinkConfigPanel
                  columnStatuses={columnStatuses}
                  setColumnStatuses={setColumnStatuses}
                  onBack={() => setIsLinkSettingsOpen(false)}
                  onSave={handleSaveLinkConfig}
                />
              ) : isFleetSettingsOpen ? (
                <FleetMasterPanel
                  fleetCars={fleetCars}
                  setFleetCars={setFleetCars}
                  reservations={reservations}
                  setReservations={setReservations}
                  setTasks={setTasks}
                  onBack={() => setIsFleetSettingsOpen(false)}
                  onSaveFleet={handleSaveFleet}
                />
              ) : isRentalCompaniesSettingsOpen ? (
                <RentalCompaniesMasterPanel
                  rentalCompanies={rentalCompanies}
                  onBack={() => setIsRentalCompaniesSettingsOpen(false)}
                  onSave={handleSaveRentalCompanies}
                />
              ) : (
                <>
                  <div className="space-y-4">
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">担当者一覧の編集</h3>
                      <p className="text-sm text-gray-500 mb-3">受付担当者・鈑金担当者・塗装担当者のプルダウンに表示する項目を追加・削除できます。</p>
                      <button type="button" onClick={() => setIsStaffOptionsOpen(true)} className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium text-sm flex items-center justify-center gap-2">
                        <Settings className="w-4 h-4" />
                        担当者一覧を編集
                      </button>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">列の増減</h3>
                      <p className="text-sm text-gray-500 mb-3">各ボード（入庫予約・全作業・鈑金・塗装・納車）ごとに、表示する列を追加・削除できます。</p>
                      <button type="button" onClick={() => setIsColumnEditOpen(true)} className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium text-sm flex items-center justify-center gap-2">
                        <Layout className="w-4 h-4" />
                        列の増減を設定
                      </button>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">ボード間リンク</h3>
                      <p className="text-sm text-gray-500 mb-3">全作業・鈑金・塗装・納車の列どうしの対応を確認・設定できます。</p>
                      <button type="button" onClick={() => setIsLinkSettingsOpen(true)} className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium text-sm flex items-center justify-center gap-2">
                        <Settings className="w-4 h-4" />
                        リンクを設定
                      </button>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
                        {orphanedTasks.length > 0 && <AlertTriangle className="w-4 h-4 text-amber-600" />}
                        表示外のカード（リンクの狭間）
                      </h3>
                      <p className="text-sm text-gray-500 mb-3">
                        ボード間リンクを変更した際、どの列にも属さないステータスになったカードは看板に表示されません。ここに表示されたカードを「移動先」で列を選んで復帰できます。
                      </p>
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-gray-600 mb-1">ナンバー・車種・お客様名で全カードを検索（例: 5402, プリウス）</label>
                        <IMEInput
                          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                          placeholder="5402 または プリウス など"
                          value={orphanSearchText}
                          onChange={(v) => setOrphanSearchText(v)}
                        />
                      </div>
                      {orphanSearchText.trim() && (
                        <div className="mb-3 p-3 rounded-lg border border-blue-200 bg-blue-50/50">
                          <p className="text-sm font-medium text-gray-800 mb-2">該当する全カード（{searchAllTasksByText.length}件）</p>
                          {searchAllTasksByText.length === 0 ? (
                            <p className="text-sm text-gray-600">該当するカードはありません。別のキーワードで試すか、Firestore の boards/main/tasks で該当ドキュメントが存在するか確認してください。</p>
                          ) : (
                            <ul className="space-y-2 text-sm">
                              {searchAllTasksByText.map(t => {
                                const isOrphan = t && t.status != null && !allValidStatuses.has(t.status);
                                const colName = !isOrphan && boardColumns ? (() => {
                                  const bid = BOARD_ORDER.find(bid => {
                                    const cols = getColumnsForBoard(boardColumnsConfig, bid);
                                    return (cols || []).some(c => getColumnStatusesForBoard(bid, c).includes(t.status));
                                  });
                                  const cols = bid ? getColumnsForBoard(boardColumnsConfig, bid) : [];
                                  const col = (cols || []).find(c => getColumnStatusesForBoard(bid, c).includes(t.status));
                                  return col ? `${getBoardTitle(bid, useIndonesian)} > ${getColumnName(col, useIndonesian)}` : t.status;
                                })() : null;
                                return (
                                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium">{t.assignee || '—'} / {t.car || '—'} {t.number || '—'}</span>
                                    <span className="text-xs text-gray-600">{isOrphan ? '（表示外）' : `（${colName}）`}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}
                      {orphanedTasks.length === 0 ? (
                        <p className="text-sm text-gray-600 py-2">表示外のカードはありません。</p>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm font-medium text-amber-700">{orphanedTasks.length}件のカードがどの列にも表示されていません</p>
                          {orphanedTasks.map(task => {
                            const selectedStatus = orphanRecoverySelection[task.id] ?? allColumnOptions[0]?.primaryStatus ?? '';
                            return (
                              <div key={task.id} className="p-3 rounded-lg border border-amber-200 bg-amber-50/50 space-y-2">
                                <div className="text-sm font-medium text-gray-800">
                                  {task.assignee || '（未設定）'} / {task.car || '（車種）'} {task.number || '（ナンバー）'}
                                </div>
                                <div className="text-xs text-gray-600">現在のステータス: {task.status || 'なし'}</div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="text-xs text-gray-600">移動先:</label>
                                  <select
                                    className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white min-w-[200px]"
                                    value={selectedStatus}
                                    onChange={(e) => setOrphanRecoverySelection(prev => ({ ...prev, [task.id]: e.target.value }))}
                                  >
                                    {allColumnOptions.map((opt, i) => (
                                      <option key={i} value={opt.primaryStatus}>{opt.label}</option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const status = orphanRecoverySelection[task.id] ?? allColumnOptions[0]?.primaryStatus;
                                      if (status) {
                                        handleTaskUpdate({ ...task, status });
                                        setOrphanRecoverySelection(prev => { const next = { ...prev }; delete next[task.id]; return next; });
                                      }
                                    }}
                                    className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                                  >
                                    この列に移動
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
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
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">レンタル会社マスタ</h3>
                      <p className="text-sm text-gray-500 mb-3">他社レンタカーの会社名プルダウン候補を管理します（オリックス・ニコニコレンタカーなど）。</p>
                      <button
                        type="button"
                        onClick={() => setIsRentalCompaniesSettingsOpen(true)}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium text-sm flex items-center justify-center gap-2"
                      >
                        <Truck className="w-4 h-4" />
                        レンタル会社マスタを開く
                      </button>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">請求書設定（インボイス）</h3>
                      <p className="text-sm text-gray-500 mb-3">請求書に印字する事業者名・登録番号・住所・振込先などを設定します。</p>
                      <button
                        type="button"
                        onClick={() => setIsInvoiceSettingsOpen(true)}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium text-sm flex items-center justify-center gap-2"
                      >
                        <FileText className="w-4 h-4" />
                        請求書設定を開く
                      </button>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">列の幅（端末別）</h3>
                      <p className="text-sm text-gray-500 mb-3">カンバン列の最小幅を端末ごとに指定できます。幅を狭くすると列数が多く見え、広くするとカードが読みやすくなります。</p>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <label className="text-sm text-gray-600 w-20 flex-shrink-0">パソコン</label>
                          <input
                            type="number"
                            min={80}
                            max={500}
                            step={10}
                            value={columnWidthConfig.desktop}
                            onChange={(e) => setColumnWidthConfig(c => ({ ...c, desktop: Math.max(80, Math.min(500, Number(e.target.value) || 80)) }))}
                            className="w-24 border border-gray-300 rounded px-2 py-1.5 text-sm"
                          />
                          <span className="text-xs text-gray-500">px</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="text-sm text-gray-600 w-20 flex-shrink-0">タブレット</label>
                          <input
                            type="number"
                            min={80}
                            max={500}
                            step={10}
                            value={columnWidthConfig.tablet}
                            onChange={(e) => setColumnWidthConfig(c => ({ ...c, tablet: Math.max(80, Math.min(500, Number(e.target.value) || 80)) }))}
                            className="w-24 border border-gray-300 rounded px-2 py-1.5 text-sm"
                          />
                          <span className="text-xs text-gray-500">px</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="text-sm text-gray-600 w-20 flex-shrink-0">スマホ</label>
                          <input
                            type="number"
                            min={80}
                            max={500}
                            step={10}
                            value={columnWidthConfig.mobile}
                            onChange={(e) => setColumnWidthConfig(c => ({ ...c, mobile: Math.max(80, Math.min(500, Number(e.target.value) || 80)) }))}
                            className="w-24 border border-gray-300 rounded px-2 py-1.5 text-sm"
                          />
                          <span className="text-xs text-gray-500">px</span>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 mt-2">判定: 幅768px未満＝スマホ、768px〜1023px＝タブレット、1024px以上＝パソコン</p>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">データ復旧</h3>
                      <p className="text-sm text-gray-500 mb-3">
                        後工程にいたカードが「入庫済み」に戻ってしまった場合、履歴をもとに直前のステータスに一括復元できます。
                      </p>
                      {anomalousReceivedTasks.length > 0 ? (
                        <>
                          <div className="mb-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-sm text-red-800">
                            {anomalousReceivedTasks.length}件の異常カードを検出しました
                          </div>
                          <div className="mb-3 max-h-40 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100 text-xs">
                            {anomalousReceivedTasks.map(t => {
                              const hist = Array.isArray(t.statusHistory) ? t.statusHistory : [];
                              const lastLater = [...hist].reverse().find(h => h && h.status && h.status !== 'received');
                              return (
                                <div key={t.id} className="px-3 py-1.5 flex items-center justify-between gap-2">
                                  <span className="truncate">{t.assignee || '未設定'} / {t.car || ''} {t.number || ''}</span>
                                  <span className="text-gray-500 flex-shrink-0">← {lastLater ? lastLater.status : '不明'}</span>
                                </div>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={batchRestoreAnomalousTasks}
                            className="w-full px-4 py-3 rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium text-sm"
                          >
                            {anomalousReceivedTasks.length}件を直前のステータスに一括復元
                          </button>
                        </>
                      ) : (
                        <div className="px-3 py-2 rounded bg-green-50 border border-green-200 text-sm text-green-800">
                          異常なカードは検出されませんでした
                        </div>
                      )}
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">データバックアップ</h3>
                      <p className="text-sm text-gray-500 mb-3">
                        全カードの現在の状態をJSONファイルとしてダウンロードします。不具合発生時の復旧用に定期的にバックアップを取ることを推奨します。
                      </p>
                      <button
                        type="button"
                        onClick={exportTasksAsJson}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium text-sm flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        バックアップをダウンロード（{tasks.length}件）
                      </button>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">カード移動履歴</h3>
                      <p className="text-sm text-gray-500 mb-3">
                        すべてのカードのステータス変更履歴を一覧で確認できます。
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSettingsOpen(false);
                          setIsLinkSettingsOpen(false);
                          setIsFleetSettingsOpen(false);
                          setIsColumnEditOpen(false);
                          setIsStaffOptionsOpen(false);
                          setCurrentView('history');
                          setSelectedTaskId(null);
                        }}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium text-sm flex items-center justify-center gap-2"
                      >
                        履歴ページを開く
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
function CreateTaskModal({ variant = 'center', fleetCars = FLEET_CARS, rentalCompanies = [], defaultReceptionStaff = 'ログインユーザー', staffOptionsConfig = null, onClose, onSubmit }) {
  const [formData, setFormData] = useState({
    maker: '', car: '', number: '', colorNo: '', assignee: '', lineUrl: '',
    entryPrimary: '個人',
    entryDetail: '',
    inDate: getTodayString(), outDate: '',
    loanerType: 'none',
    loanerCarId: '',
    otherRentalName: '',
    rentalCompanyId: '',
    plannedDays: '',
    receptionStaff: defaultReceptionStaff,
    bodyStaff: '',
    paintStaff: '',
    color: 'bg-white', dots: ['white', 'white', 'white', 'white'],
    characters: [], tasks: [], description: ''
  });
  const [activeDotIndex, setActiveDotIndex] = useState(0);
  const [attachments, setAttachments] = useState([]);
  const [makerQuery, setMakerQuery] = useState('');
  const [modelQuery, setModelQuery] = useState('');

  const makerOptions = useMemo(() => {
    const makers = Object.keys(CAR_MODELS);
    if (!makerQuery.trim()) return makers;
    const qNorm = normalizeKana(makerQuery.trim());
    return makers.filter(m => normalizeKana(m).startsWith(qNorm));
  }, [makerQuery]);

  const modelOptions = useMemo(() => {
    if (!formData.maker) return [];
    const models = CAR_MODELS[formData.maker] || [];
    if (!modelQuery.trim()) return models;
    const qNorm = normalizeKana(modelQuery.trim());
    return models.filter(m => normalizeKana(m).startsWith(qNorm));
  }, [formData.maker, modelQuery, formData.car]);

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
      const data = await readFileAsDataUrl(file);
      next.push({ type, name: file.name, data });
    }
    setAttachments(next);
    e.target.value = '';
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const isSide = variant === 'side';
  const outerClasses = isSide
    ? 'fixed inset-y-0 right-0 z-50 flex items-stretch justify-end'
    : 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
  const panelClasses = isSide
    ? 'bg-white shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.2)] w-full max-w-md flex flex-col h-full'
    : 'bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]';
  const bodyClasses = isSide
    ? 'flex-1 overflow-y-auto px-4 py-4 space-y-6'
    : 'flex-1 overflow-y-auto px-6 py-4 space-y-6';
  const iconLabelClass = isSide ? 'w-24 text-xs' : 'w-32 text-sm';

  return (
    <div className={outerClasses}>
      <div className={panelClasses}>
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
          <h2 className={`font-bold text-gray-800 ${isSide ? 'text-lg' : 'text-xl'}`}>カードの作成</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button>
        </div>

        <div className={bodyClasses}>
          <form id="create-task-form" onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                <label className={`${iconLabelClass} text-right font-medium text-gray-700 mt-1`}>表示アイコン</label>
                <div className="flex-1 flex gap-2 text-gray-500 flex-wrap">
                  {AVAILABLE_CHARACTERS.map(char => {
                    const Icon = char.icon;
                    return (
                      <button type="button" key={char.id} onClick={() => setFormData(p => ({...p, characters: p.characters.includes(char.id) ? p.characters.filter(c=>c!==char.id) : [...p.characters, char.id]}))} className={`p-1 rounded ${formData.characters.includes(char.id) ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}>
                        <Icon className={isSide ? 'w-4 h-4' : 'w-5 h-5'} />
                      </button>
                    );
                  })}
                  <div className="w-px h-6 bg-gray-300 mx-1"></div>
                  {AVAILABLE_TASKS.map(task => {
                    const Icon = task.icon;
                    return (
                      <button type="button" key={task.id} onClick={() => setFormData(p => ({...p, tasks: p.tasks.includes(task.id) ? p.tasks.filter(t=>t!==task.id) : [...p.tasks, task.id]}))} className={`p-1 rounded ${formData.tasks.includes(task.id) ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}>
                        <Icon className={isSide ? 'w-4 h-4' : 'w-5 h-5'} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <hr className="border-gray-200" />

            <div className="space-y-4">
              <div className="flex gap-4 items-center flex-wrap">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">入庫日</label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!formData.inDate}
                      onChange={(e) => setFormData({ ...formData, inDate: e.target.checked ? '' : getTodayString() })}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">入庫日未定</span>
                  </label>
                  {formData.inDate ? (
                    <input
                      type="date"
                      className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40"
                      value={formData.inDate}
                      onChange={(e) => setFormData({ ...formData, inDate: e.target.value })}
                    />
                  ) : (
                    <span className="text-sm text-gray-500">（日付を指定する場合はチェックを外すと当日が入ります）</span>
                  )}
                </div>
              </div>
              <div className="flex gap-4 items-center">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">納車日</label>
                <input type="date" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40" value={formData.outDate} onChange={(e) => setFormData({...formData, outDate: e.target.value})} />
              </div>

              <div className="flex gap-4 items-center mt-2">
                <label className="w-32 text-right text-sm font-medium text-gray-700">代車・レンタカー</label>
                <div className="flex-1 flex flex-col gap-2">
                  <select
                    className="w-full max-w-[200px] border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                    value={formData.loanerType}
                    onChange={(e) => setFormData({...formData, loanerType: e.target.value, loanerCarId: e.target.value === 'none' ? '' : formData.loanerCarId, otherRentalName: e.target.value === 'other_rental' ? formData.otherRentalName : '', rentalCompanyId: e.target.value === 'other_rental' ? formData.rentalCompanyId : '', plannedDays: e.target.value === 'none' ? '' : formData.plannedDays})}
                  >
                    {LOANER_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                  </select>
                  {formData.loanerType === 'other_rental' ? (
                    <div className="flex flex-col gap-2">
                      <select
                        className="w-full max-w-[280px] border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                        value={formData.rentalCompanyId}
                        onChange={(e) => {
                          const id = e.target.value;
                          const picked = rentalCompanies.find(c => c.id === id);
                          setFormData({...formData, rentalCompanyId: id, otherRentalName: picked ? picked.name : formData.otherRentalName});
                        }}
                      >
                        <option value="">会社をマスタから選択（任意）</option>
                        {rentalCompanies.filter(c => c.isActive !== false).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <IMEInput
                        className="w-full max-w-[280px] border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
                        placeholder="レンタカー会社名（例: トヨタレンタカー）"
                        value={formData.otherRentalName}
                        onChange={(v) => setFormData({...formData, otherRentalName: v})}
                      />
                    </div>
                  ) : formData.loanerType !== 'none' && (
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
                  {formData.loanerType !== 'none' && (
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      予定貸出日数
                      <input
                        type="number"
                        min={1}
                        max={365}
                        className="w-20 border border-gray-300 rounded px-2 py-1 text-sm"
                        value={formData.plannedDays}
                        onChange={(e) => setFormData({...formData, plannedDays: e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0)})}
                        placeholder="日数"
                      />
                      <span className="text-gray-500">日（空欄可）</span>
                    </label>
                  )}
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">メーカー <span className="text-red-500">*</span></label>
                <div className="flex-1 space-y-2">
                  <IMEInput
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                    placeholder="メーカー名で絞り込み（例: トヨタ）"
                    value={makerQuery}
                    onChange={(v) => setMakerQuery(v)}
                  />
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
                    value={formData.maker}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({ ...formData, maker: value, car: '' });
                      setMakerQuery(value);
                      setModelQuery('');
                    }}
                    required
                  >
                    <option value="" disabled>選択してください</option>
                    {makerOptions.map(maker => (
                      <option key={maker} value={maker}>{maker}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">モデル <span className="text-red-500">*</span></label>
                <div className="flex-1 space-y-2">
                  <IMEInput
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
                    placeholder={formData.maker ? "車種名で絞り込み（例: プリウス）" : "先にメーカーを選択してください"}
                    value={modelQuery}
                    onChange={(v) => setModelQuery(v)}
                    disabled={!formData.maker}
                  />
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white disabled:bg-gray-100"
                    value={formData.car}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({ ...formData, car: value });
                      setModelQuery(value);
                    }}
                    disabled={!formData.maker}
                    required
                  >
                    <option value="" disabled>{formData.maker ? '選択してください' : 'メーカーを先に選択'}</option>
                    {formData.maker && modelOptions.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-4 items-center">
                <label className="w-32 text-right text-sm font-medium text-gray-700">カラーナンバー</label>
                <IMEInput className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="例: 3R2" value={formData.colorNo || ''} onChange={v => setFormData({...formData, colorNo: v})} />
              </div>

              <div className="flex gap-4 items-center">
                 <label className="w-32 text-right text-sm font-medium text-gray-700">車番</label>
                 <IMEInput className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="例: 1234" value={formData.number} onChange={v => setFormData({...formData, number: v})} />
              </div>
              <div className="flex gap-4 items-center">
                 <label className="w-32 text-right text-sm font-medium text-gray-700">顧客名</label>
                 <IMEInput className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm" placeholder="例: 山田太郎" value={formData.assignee} onChange={v => setFormData({...formData, assignee: v})} />
              </div>
              <div className="flex gap-4 items-center">
                 <label className="w-32 text-right text-sm font-medium text-gray-700">LINEリンク</label>
                 <input
                   type="url"
                   className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm"
                   placeholder="例: https://line.me/ti/p/..."
                   value={formData.lineUrl || ''}
                   onChange={e => setFormData({...formData, lineUrl: e.target.value})}
                 />
              </div>

              {/* 入庫先ジャンル */}
              <div className="flex gap-4 items-start">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">入庫先ジャンル</label>
                <div className="flex-1 space-y-2">
                  <select
                    className="w-full max-w-[200px] border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
                    value={formData.entryPrimary}
                    onChange={(e) => setFormData({ ...formData, entryPrimary: e.target.value, entryDetail: '' })}
                  >
                    {ENTRY_PRIMARY_OPTIONS.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <div className="space-y-1">
                    <IMEInput
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                      placeholder={formData.entryPrimary === '個人'
                        ? '例: 個人（紹介元などあれば記載）'
                        : formData.entryPrimary === '業者'
                        ? '例: ヤナセ ○○店'
                        : formData.entryPrimary === '保険'
                        ? '例: 東京海上日動 ○○支社'
                        : '代理店名'}
                      value={formData.entryDetail}
                      onChange={(v) => setFormData({ ...formData, entryDetail: v })}
                    />
                    {(formData.entryPrimary === '業者' || formData.entryPrimary === '保険') && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {(ENTRY_SECONDARY_PRESETS[formData.entryPrimary] || []).map(name => (
                          <button
                            type="button"
                            key={name}
                            onClick={() => setFormData({ ...formData, entryDetail: name })}
                            className="px-2 py-0.5 rounded border border-gray-300 text-xs text-gray-700 hover:bg-gray-100"
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-4 items-center">
                <label className="w-32 text-right text-sm font-medium text-gray-700">受付担当者</label>
                <div className="flex-1">
                  <select
                    className="w-full max-w-[200px] border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                    value={formData.receptionStaff}
                    onChange={(e) => setFormData({...formData, receptionStaff: e.target.value})}
                    title="受付担当者を選択してください"
                  >
                    {getStaffOptionsWithCurrentUser(defaultReceptionStaff, staffOptionsConfig || getStaffOptionsConfig(), 'reception').map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-4 items-center">
                <label className="w-32 text-right text-sm font-medium text-gray-700">鈑金担当者</label>
                <div className="flex-1">
                  <select
                    className="w-full max-w-[200px] border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                    value={formData.bodyStaff}
                    onChange={(e) => setFormData({...formData, bodyStaff: e.target.value})}
                  >
                    <option value="">選択してください</option>
                    {getStaffOptionsWithCurrentUser(defaultReceptionStaff, staffOptionsConfig || getStaffOptionsConfig(), 'body').filter(name => name !== defaultReceptionStaff).map(name => (
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
                    {getStaffOptionsWithCurrentUser(defaultReceptionStaff, staffOptionsConfig || getStaffOptionsConfig(), 'paint').filter(name => name !== defaultReceptionStaff).map(name => (
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
                      <button
                        type="button"
                        key={index}
                        onClick={() => setActiveDotIndex(index)}
                        className={`w-6 h-6 rounded-full border-2 ${
                          activeDotIndex === index ? 'ring-2 ring-offset-1 ring-blue-500' : ''
                        } ${
                          dotColor === 'red'
                            ? 'border-red-500 bg-red-100'
                            : dotColor === 'yellow'
                            ? 'border-yellow-400 bg-yellow-100'
                            : dotColor === 'blue'
                            ? 'border-blue-500 bg-blue-100'
                            : dotColor === 'green'
                            ? 'border-green-500 bg-green-100'
                            : dotColor === 'black'
                            ? 'border-black bg-black/70'
                            : dotColor === 'brown'
                            ? 'border-amber-800 bg-amber-800/80'
                            : 'border-gray-400 bg-white'
                        }`}
                      ></button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {['red', 'yellow', 'blue', 'green', 'black', 'brown', 'white'].map(color => (
                      <button
                        type="button"
                        key={color}
                        onClick={() => {
                          const newDots = [...formData.dots];
                          newDots[activeDotIndex] = color;
                          setFormData({ ...formData, dots: newDots });
                        }}
                        className={`w-5 h-5 rounded border border-gray-300 hover:scale-110 transition-transform ${
                          color === 'red'
                            ? 'bg-red-500'
                            : color === 'yellow'
                            ? 'bg-yellow-400'
                            : color === 'blue'
                            ? 'bg-blue-500'
                            : color === 'green'
                            ? 'bg-green-500'
                            : color === 'black'
                            ? 'bg-black'
                            : color === 'brown'
                            ? 'bg-amber-800'
                            : 'bg-white'
                        }`}
                      ></button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-4 items-center">
                <label className="w-32 text-right text-sm font-medium text-gray-700">カードの色</label>
                <div className="flex gap-1 flex-wrap flex-1">
                  {CARD_COLOR_OPTIONS.map(colorClass => (
                    <button
                      type="button"
                      key={colorClass}
                      onClick={() => setFormData({...formData, color: colorClass})}
                      className={`w-6 h-6 rounded border ${colorClass} ${formData.color === colorClass ? 'ring-2 ring-offset-1 ring-blue-500 border-transparent' : 'border-gray-300'}`}
                    />
                  ))}
                </div>
              </div>

              {/* 説明 */}
              <div className="flex gap-4 items-start mt-4">
                <label className="w-32 text-right text-sm font-medium text-gray-700 mt-1">説明</label>
                <div className="flex-1">
                  <IMETextarea
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none min-h-[100px] resize-y"
                    placeholder="カードの説明や特記事項を入力してください..."
                    value={formData.description}
                    onChange={(v) => setFormData({...formData, description: v})}
                  />
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

const MASTER_PASSCODE = '0514';

function TaskDetailPanel({ task, fleetCars = [], rentalCompanies = [], defaultReceptionStaff = 'ログインユーザー', staffOptionsConfig = null, onClose, onUpdate, onMasterDelete, currentBoardId = null, boardColumns = [], getColumnStatuses = null, getColumnPrimaryStatus = null, moveTargetOptions = [], useIndonesian = false, viewOnly = false, usedBinderNumbers = new Set(), currentUser = '', currentUserEmail = '' }) {
  const [activeDotIndex, setActiveDotIndex] = useState(0);
  const [selectedMoveTarget, setSelectedMoveTarget] = useState('');
  const [showPrevNextMove, setShowPrevNextMove] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  // カメラ撮影機能用: ログイン状態の判定（現場端末/デモユーザー等の擬似ログインは未認証扱い）
  const isCameraAuthed = !!(currentUser && currentUserEmail);
  if (!task) return null;
  const effectiveOnUpdate = viewOnly ? () => {} : onUpdate;
  const issueKey = `#${task.id.replace(/\D/g, '') || Math.floor(Math.random()*1000) + 2000}`;
  const dots = task.dots || ['white', 'white', 'white', 'white'];
  const config = staffOptionsConfig || getStaffOptionsConfig();
  const receptionOptions = getStaffOptionsWithCurrentUser(defaultReceptionStaff, config, 'reception');
  const bodyOptions = getStaffOptionsWithCurrentUser(defaultReceptionStaff, config, 'body').filter(name => name !== defaultReceptionStaff);
  const paintOptions = getStaffOptionsWithCurrentUser(defaultReceptionStaff, config, 'paint').filter(name => name !== defaultReceptionStaff);
  const loanerFleetCar = task.loanerCarId ? fleetCars.find(f => f.id === task.loanerCarId) : null;

  const handleDotColor = (color) => {
    const newDots = [...dots];
    newDots[activeDotIndex] = color;
    effectiveOnUpdate({ ...task, dots: newDots });
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
    effectiveOnUpdate({ ...task, attachments: list });
    e.target.value = '';
  };

  const removeAttachment = (index) => {
    const list = (task.attachments || []).filter((_, i) => i !== index);
    effectiveOnUpdate({ ...task, attachments: list });
  };

  const attachmentsList = Array.isArray(task.attachments) ? task.attachments : [];

  return (
    <div className="flex h-full text-gray-800 bg-white">
      <div className="flex-1 flex flex-col h-full overflow-hidden border-l border-gray-200 shadow-xl">
        {viewOnly && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            閲覧専用です（スマホ・タブレット）
          </div>
        )}
        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-10">
          <div className="flex items-center text-sm text-gray-500 gap-2 overflow-hidden">
             <div className="w-5 h-5 bg-gradient-to-tr from-cyan-400 to-blue-500 rounded flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold">A</div>
            <span className="truncate">株式会社 清田自動車 / <span className="text-blue-600 font-medium">{issueKey}</span></span>
             {!viewOnly && (
                 <div className="ml-2 flex items-center gap-1.5 flex-shrink-0">
                   <span className="text-xs text-gray-400">バインダー:</span>
                   <select
                     value={task.binderNumber || ''}
                     onChange={(e) => effectiveOnUpdate({ ...task, binderNumber: e.target.value || null })}
                     className="border border-gray-300 rounded px-1.5 py-0.5 text-xs font-medium bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                     style={{ minWidth: '56px' }}
                   >
                     <option value="">--</option>
                     {Array.from({ length: 70 }, (_, i) => {
                       const num = String(i + 1).padStart(2, '0');
                       const inUse = usedBinderNumbers.has(num);
                       return <option key={num} value={num} disabled={inUse}>{num}{inUse ? ' (使用中)' : ''}</option>;
                     })}
                   </select>
                 </div>
             )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:bg-gray-100 p-1.5 rounded"><X className="w-5 h-5" /></button>
        </div>

        <div className={`flex-1 overflow-y-auto p-4 space-y-2 ${viewOnly ? 'pointer-events-none select-none' : ''}`}>
          <div className="mb-4 flex items-start gap-2">
             <div className="text-xl font-bold flex-1">- {(task.assignee || '').split(' ')[0]} {task.car}{task.number}</div>
          </div>

          <div className="py-3 pl-6 pr-2 space-y-3 text-sm border-b border-gray-200">
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">代車・レンタカー:</span>
               <select
                 value={task.loanerType || 'none'}
                 onChange={(e) => effectiveOnUpdate({ ...task, loanerType: e.target.value })}
                 className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[200px] transition-colors bg-gray-50"
               >
                 {LOANER_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
               </select>
            </div>
            {task.loanerType === 'other_rental' && (
              <>
                <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                  <span className="text-gray-500">会社マスタ:</span>
                  <select
                    value={task.rentalCompanyId || ''}
                    onChange={(e) => {
                      const id = e.target.value;
                      const picked = rentalCompanies.find(c => c.id === id);
                      effectiveOnUpdate({ ...task, rentalCompanyId: id, otherRentalName: picked ? picked.name : task.otherRentalName });
                    }}
                    className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[280px] transition-colors bg-gray-50"
                  >
                    <option value="">マスタから選択（任意）</option>
                    {rentalCompanies.filter(c => c.isActive !== false).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                  <span className="text-gray-500">レンタカー会社:</span>
                  <IMEInput
                    value={task.otherRentalName || ''}
                    onChange={(v) => effectiveOnUpdate({ ...task, otherRentalName: v })}
                    placeholder="レンタカー会社名（例: トヨタレンタカー）"
                    className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[280px] transition-colors bg-gray-50"
                  />
                </div>
              </>
            )}
            {task.loanerType && task.loanerType !== 'none' && (
              <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                <span className="text-gray-500">予定貸出日数:</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={task.plannedDays ?? ''}
                    onChange={(e) => effectiveOnUpdate({ ...task, plannedDays: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })}
                    placeholder="日数"
                    className="w-20 border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none bg-gray-50"
                  />
                  <span className="text-xs text-gray-500">日（空欄可）</span>
                </div>
              </div>
            )}
            {task.loanerType && task.loanerType !== 'none' && task.loanerType !== 'other_rental' && (
              <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                <span className="text-gray-500">代車（貸出車両）:</span>
                <select
                  value={task.loanerCarId || ''}
                  onChange={(e) => effectiveOnUpdate({ ...task, loanerCarId: e.target.value })}
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
               <IMEInput value={task.car || ''} onChange={(v) => effectiveOnUpdate({ ...task, car: v })} className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[250px]" />
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">カラーナンバー:</span>
               <IMEInput value={task.colorNo || ''} onChange={(v) => effectiveOnUpdate({ ...task, colorNo: v })} className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[250px]" placeholder="例: 3R2" />
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">車番:</span>
               <IMEInput value={task.number || ''} onChange={(v) => effectiveOnUpdate({ ...task, number: v })} className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[250px]" />
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">顧客:</span>
               <IMEInput value={task.assignee || ''} onChange={(v) => effectiveOnUpdate({ ...task, assignee: v })} className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[250px]" />
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">入庫先ジャンル:</span>
               <div className="space-y-1">
                 <select
                   value={task.entryPrimary || '個人'}
                   onChange={(e) => effectiveOnUpdate({ ...task, entryPrimary: e.target.value })}
                   className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[160px] bg-white"
                 >
                   {ENTRY_PRIMARY_OPTIONS.map(opt => (
                     <option key={opt} value={opt}>{opt}</option>
                   ))}
                 </select>
                 <div className="flex flex-col gap-1">
                   <IMEInput
                     value={task.entryDetail || ''}
                     onChange={(v) => effectiveOnUpdate({ ...task, entryDetail: v })}
                     className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[250px]"
                     placeholder="詳細（例: ヤナセ、東京海上日動 など）"
                   />
                   {(task.entryPrimary === '業者' || task.entryPrimary === '保険') && (
                     <div className="flex flex-wrap gap-1">
                       {(ENTRY_SECONDARY_PRESETS[task.entryPrimary] || []).map(name => (
                         <button
                           key={name}
                           type="button"
                           onClick={() => effectiveOnUpdate({ ...task, entryDetail: name })}
                           className="px-2 py-0.5 rounded border border-gray-300 text-xs text-gray-700 hover:bg-gray-100"
                         >
                           {name}
                         </button>
                       ))}
                     </div>
                   )}
                 </div>
               </div>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">LINEリンク:</span>
               <div className="flex items-center gap-2">
                 <input
                   type="url"
                   value={task.lineUrl || ''}
                   onChange={(e) => effectiveOnUpdate({ ...task, lineUrl: e.target.value })}
                   className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[250px]"
                   placeholder="例: https://line.me/ti/p/..."
                 />
                 {task.lineUrl && (
                   <button
                     type="button"
                     onClick={() => window.open(task.lineUrl, '_blank', 'noopener,noreferrer')}
                     className="inline-flex items-center gap-1 px-2 py-1 rounded border border-green-500 text-green-700 text-xs hover:bg-green-50"
                     title="LINEトーク画面を開く"
                   >
                     <MessageCircle className="w-3.5 h-3.5" />
                     開く
                   </button>
                 )}
               </div>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">受付担当者:</span>
               <select
                 value={task.receptionStaff || ''}
                 onChange={(e) => effectiveOnUpdate({ ...task, receptionStaff: e.target.value })}
                 className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[200px] transition-colors bg-gray-50"
               >
                 {receptionOptions.map(name => <option key={name} value={name}>{name}</option>)}
               </select>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
               <span className="text-gray-500 pt-1.5">見積チェッカー:</span>
               <a
                 href={`${import.meta.env.BASE_URL}estimator/見積もりチェッカー2.html?${new URLSearchParams({
                   お客様名: task.assignee || '',
                   車種: (task.maker ? task.maker + ' ' + task.car : task.car) || '',
                   ナンバー: task.number || '',
                   カラーNo: task.colorNo || '',
                   担当者: task.receptionStaff || ''
                 }).toString()}`}
                 target="_blank"
                 rel="noopener noreferrer"
                 className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-medium transition-colors"
               >
                 <FileText className="w-4 h-4" />
                 見積もりチェッカーで開く
               </a>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
               <span className="text-gray-500 pt-1.5">請求書発行:</span>
               <button
                 type="button"
                 onClick={() => setIsInvoiceModalOpen(true)}
                 className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-sm font-medium transition-colors border border-emerald-200"
               >
                 <FileText className="w-4 h-4" />
                 請求書を作成・印刷
               </button>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">鈑金担当者:</span>
               <select
                 value={task.bodyStaff || ''}
                 onChange={(e) => effectiveOnUpdate({ ...task, bodyStaff: e.target.value })}
                 className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[200px] transition-colors bg-gray-50"
               >
                 <option value="">選択してください</option>
                 {bodyOptions.map(name => <option key={name} value={name}>{name}</option>)}
               </select>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
               <span className="text-gray-500">塗装担当者:</span>
               <select
                 value={task.paintStaff || ''}
                 onChange={(e) => effectiveOnUpdate({ ...task, paintStaff: e.target.value })}
                 className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[200px] transition-colors bg-gray-50"
               >
                 <option value="">選択してください</option>
                 {paintOptions.map(name => <option key={name} value={name}>{name}</option>)}
               </select>
            </div>
          </div>

          <Accordion title="日付" defaultOpen={true}>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                 <span className="text-gray-500">入庫日:</span>
                 <input type="date" value={task.inDate || ''} onChange={(e) => effectiveOnUpdate({ ...task, inDate: e.target.value })} className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[150px]" />
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                 <span className="text-gray-500">納車日:</span>
                 <input type="date" value={task.outDate || ''} onChange={(e) => effectiveOnUpdate({ ...task, outDate: e.target.value })} className="border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-2 py-1 text-sm focus:outline-none w-full max-w-[150px]" />
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
                    className={`w-6 h-6 rounded-full border-2 flex-shrink-0 ${
                      activeDotIndex === index ? 'ring-2 ring-offset-1 ring-blue-500' : ''
                    } ${
                      dotColor === 'red'
                        ? 'border-red-500 bg-red-100'
                        : dotColor === 'yellow'
                        ? 'border-yellow-400 bg-yellow-100'
                        : dotColor === 'blue'
                        ? 'border-blue-500 bg-blue-100'
                        : dotColor === 'green'
                        ? 'border-green-500 bg-green-100'
                        : dotColor === 'black'
                        ? 'border-black bg-black/70'
                        : dotColor === 'brown'
                        ? 'border-amber-800 bg-amber-800/80'
                        : 'border-gray-400 bg-white'
                    }`}
                  />
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                {['red', 'yellow', 'blue', 'green', 'black', 'brown', 'white'].map(color => (
                  <button
                    type="button"
                    key={color}
                    onClick={() => handleDotColor(color)}
                    className={`w-5 h-5 rounded border border-gray-300 hover:scale-110 transition-transform ${
                      color === 'red'
                        ? 'bg-red-500'
                        : color === 'yellow'
                        ? 'bg-yellow-400'
                        : color === 'blue'
                        ? 'bg-blue-500'
                        : color === 'green'
                        ? 'bg-green-500'
                        : color === 'black'
                        ? 'bg-black'
                        : color === 'brown'
                        ? 'bg-amber-800'
                        : 'bg-white'
                    }`}
                  />
                ))}
              </div>
            </div>
          </Accordion>

          <Accordion title="カードの色" defaultOpen={true}>
            <div className="flex gap-1 flex-wrap">
              {CARD_COLOR_OPTIONS.map(colorClass => (
                <button
                  type="button"
                  key={colorClass}
                  onClick={() => effectiveOnUpdate({ ...task, color: colorClass })}
                  className={`w-6 h-6 rounded border ${colorClass} ${(task.color || 'bg-white') === colorClass ? 'ring-2 ring-offset-1 ring-blue-500 border-transparent' : 'border-gray-300'}`}
                />
              ))}
            </div>
          </Accordion>

          <Accordion title="説明" defaultOpen={true}>
            <IMETextarea
              className="w-full text-sm text-gray-700 p-2 border border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none rounded resize-y min-h-[80px]"
              value={task.description !== undefined ? task.description : ''}
              onChange={(v) => effectiveOnUpdate({ ...task, description: v })}
              placeholder="カードの説明や特記事項を入力してください..."
            />
          </Accordion>

          <Accordion title="撮影（鈑金フェーズ別）" defaultOpen={true}>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setIsCameraOpen(true)}
                disabled={viewOnly || !isCameraAuthed}
                title={!isCameraAuthed ? 'ログインが必要です' : undefined}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-sm"
              >
                <CameraIcon className="w-5 h-5" />
                撮影する（IN/B/P/OUT）
              </button>
              <p className="text-xs text-gray-500">
                フェーズタグ別にフォルダ自動振り分け。撮影後 PC側で「全画像ZIP」DL予定（Phase 2）。
              </p>
              {!isCameraAuthed && !viewOnly && (
                <p className="text-xs text-amber-600">
                  ログインが必要です（Google ログイン後に撮影可能）。
                  <a
                    href="?forceLogin=1"
                    className="ml-1 underline text-blue-600 hover:text-blue-800"
                  >
                    ログインする
                  </a>
                </p>
              )}
            </div>
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
                  accept="image/*,.pdf"
                  multiple
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  title="PDFまたは画像を選択"
                />
              </div>
              {/* 移動先を指定（どのボードのどの列に移動するか） */}
              {!viewOnly && Array.isArray(moveTargetOptions) && moveTargetOptions.length > 0 && onUpdate && (
                <div className="pt-3 border-t border-gray-200 space-y-2">
                  <div className="text-sm font-semibold text-gray-700">移動先を指定</div>
                  <p className="text-xs text-gray-500">ボード・列を選んで「この列に移動」でカードを移動できます（迷子列から復帰するときなど）。</p>
                  <select
                    value={selectedMoveTarget}
                    onChange={(e) => setSelectedMoveTarget(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                  >
                    <option value="">ボード・列を選択</option>
                    {moveTargetOptions.map((opt, i) => (
                      <option key={i} value={opt.primaryStatus}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedMoveTarget || selectedMoveTarget === task.status}
                    onClick={() => {
                      if (!selectedMoveTarget || selectedMoveTarget === task.status) return;
                      effectiveOnUpdate({ ...task, status: selectedMoveTarget });
                      setSelectedMoveTarget('');
                    }}
                    className="w-full mt-1 inline-flex items-center justify-center px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-sm"
                  >
                    この列に移動
                  </button>
                </div>
              )}

              {/* 前後列へ移動（同一パスコード） */}
              {!viewOnly && currentBoardId && Array.isArray(boardColumns) && boardColumns.length > 0 && typeof getColumnStatuses === 'function' && typeof getColumnPrimaryStatus === 'function' && onUpdate && (
                <div className="pt-3 border-t border-gray-200 space-y-2">
                  {!showPrevNextMove ? (
                    <button
                      type="button"
                      onClick={() => {
                        const code = window.prompt('前後列へ移動するためのパスコードを入力してください。');
                        if (code === null) return;
                        if (code !== MASTER_PASSCODE) {
                          window.alert('パスコードが違います。');
                          return;
                        }
                        setShowPrevNextMove(true);
                      }}
                      className="w-full mt-1 inline-flex items-center justify-center px-3 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold shadow-sm"
                    >
                      前後列へ移動
                    </button>
                  ) : (
                    (() => {
                      const idx = boardColumns.findIndex((col) => {
                        const statuses = getColumnStatuses(col);
                        return Array.isArray(statuses) && statuses.includes(task.status);
                      });
                      const prevCol = idx > 0 ? boardColumns[idx - 1] : null;
                      const nextCol = idx >= 0 && idx < boardColumns.length - 1 ? boardColumns[idx + 1] : null;
                      const prevStatus = prevCol ? getColumnPrimaryStatus(prevCol) : null;
                      const nextStatus = nextCol ? getColumnPrimaryStatus(nextCol) : null;
                      return (
                        <div className="space-y-2">
                          <div className="text-xs text-gray-600 font-medium">現在のボード内で前後の列へ移動</div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={!prevStatus}
                              onClick={() => {
                                if (!prevStatus) return;
                                effectiveOnUpdate({ ...task, status: prevStatus });
                                setShowPrevNextMove(false);
                              }}
                              className="flex-1 px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-gray-800 text-sm font-medium"
                            >
                              前の列へ
                            </button>
                            <button
                              type="button"
                              disabled={!nextStatus}
                              onClick={() => {
                                if (!nextStatus) return;
                                effectiveOnUpdate({ ...task, status: nextStatus });
                                setShowPrevNextMove(false);
                              }}
                              className="flex-1 px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-gray-800 text-sm font-medium"
                            >
                              次の列へ
                            </button>
                          </div>
                          <button type="button" onClick={() => setShowPrevNextMove(false)} className="text-xs text-gray-500 hover:underline">
                            閉じる
                          </button>
                        </div>
                      );
                    })()
                  )}
                </div>
              )}

              {!viewOnly && onMasterDelete && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const code = window.prompt('マスター削除用のパスコードを入力してください。');
                      if (code === null) return;
                      if (code !== MASTER_PASSCODE) {
                        window.alert('パスコードが違います。');
                        return;
                      }
                      if (window.confirm('このカードを完全に削除します。紐づく代車予約も削除されます。よろしいですか？')) {
                        onMasterDelete(task.id);
                      }
                    }}
                    className="w-full mt-1 inline-flex items-center justify-center px-3 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-semibold shadow-sm"
                  >
                    マスター権限で削除
                  </button>
                </div>
              )}
            </div>
          </Accordion>
        </div>
      </div>
      {isInvoiceModalOpen && task && (
        <InvoiceModal
          task={task}
          onClose={() => setIsInvoiceModalOpen(false)}
        />
      )}
      {isCameraOpen && isCameraAuthed && (
        <CameraCapture
          open={isCameraOpen}
          task={task}
          currentUser={{ displayName: currentUser, email: currentUserEmail }}
          onClose={() => setIsCameraOpen(false)}
          onPhotoSaved={(meta) => {
            // Phase 1 ではトーストのみ。Firestore は photoStorage.js が直接書く
            console.log('photo saved', meta);
          }}
          onError={(err) => {
            console.error('camera upload error', err);
            alert(`写真の保存に失敗しました: ${err && err.message ? err.message : err}`);
          }}
        />
      )}
    </div>
  );
}

// --- メインエントリーポイント ---
function getAllowedEmails() {
  const raw = import.meta.env.VITE_ALLOWED_EMAILS;
  if (!raw || typeof raw !== 'string') return null;
  return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// 不具合通知（カード→目安箱DnD）の送信先。env で上書き可。デフォルトはオーナー固定
function getIncidentReportTo() {
  const raw = import.meta.env.VITE_INCIDENT_REPORT_TO;
  const fallback = 'izumi.coinzoom@gmail.com';
  return ((raw && typeof raw === 'string' && raw.trim()) ? raw.trim() : fallback).toLowerCase();
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isSignInLoading, setIsSignInLoading] = useState(false);
  const [nfcTaskId, setNfcTaskId] = useState(null);
  const [nfcBinderNumber, setNfcBinderNumber] = useState(null);
  const isDemoLoginBypass = import.meta.env.VITE_DEMO_MODE === 'true';
  const isNfcStandalone =
    typeof window !== 'undefined' &&
    (() => {
      const params = new URLSearchParams(window.location.search);
      const flag = params.get('nfcStandalone') === '1';
      const hasNfcId = !!params.get('nfcTaskId');
      const isNarrow = window.innerWidth < 768;
      // ハッシュルート: #/tag/XX でバインダー番号指定
      const hash = window.location.hash || '';
      const tagMatch = hash.match(/^#\/tag\/(.+)$/);
      const hasTag = !!tagMatch;
      return flag || (hasNfcId && isNarrow) || hasTag;
    })();

  // バインダー番号（#/tag/XX）からnfcBinderNumberを設定
  useEffect(() => {
    const hash = window.location.hash || '';
    const tagMatch = hash.match(/^#\/tag\/(.+)$/);
    if (tagMatch) {
      setNfcBinderNumber(tagMatch[1]);
    }
  }, []);

  useEffect(() => {
    const q = window.location.search;
    if (q && q.includes('fromCalendar=1')) {
      try { sessionStorage.setItem(CALENDAR_PENDING_KEY, q); } catch (_) {}
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      let nfcId = params.get('nfcTaskId');
      // スマホでログインリダイレクト後に戻るとURLからnfcTaskIdが消えるため、sessionStorageから復元
      if (!nfcId) {
        try {
          nfcId = sessionStorage.getItem(NFC_PENDING_KEY);
          if (nfcId) sessionStorage.removeItem(NFC_PENDING_KEY);
        } catch (_) {}
      }
      if (nfcId) {
        setNfcTaskId(nfcId);
        try { sessionStorage.setItem(NFC_PENDING_KEY, nfcId); } catch (_) {}
        params.delete('nfcTaskId');
      }
      const fromCal = params.get('fromCalendar');
      // fromCalendar はセッションストレージに退避済みなので URL からは消しておく
      if (fromCal === '1') {
        params.delete('fromCalendar');
      }
      const newSearch = params.toString();
      const newUrl = (window.location.pathname || '/') + (newSearch ? `?${newSearch}` : '');
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  useEffect(() => {
    // デモビルド（VITE_DEMO_MODE=true）ではログインなしで利用できるようにする
    if (isDemoLoginBypass) {
      setCurrentUser('デモユーザー');
      setCurrentUserEmail('');
      setIsLoggedIn(true);
      setIsAuthLoading(false);
      return;
    }

    // ローカル開発環境（localhost等）の場合は Firebase 認証を使わず、自動的にログイン扱いにする
    const isLocalHost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '');
    if (isLocalHost) {
      setCurrentUser('ローカルユーザー');
      setCurrentUserEmail('');
      setIsLoggedIn(true);
      setIsAuthLoading(false);
      return;
    }

    // スマートフォン・タブレットの場合は Google ログインを免除し、そのまま利用可能にする（PC のみログイン必須）
    // URL に forceLogin=1 がある場合はログイン画面を表示（左サイドのアカウントアイコンから「ログイン」を選んだ場合）
    const forceLogin = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('forceLogin') === '1';
    if (isMobileOrNarrow() && !forceLogin) {
      setCurrentUser('現場端末');
      setCurrentUserEmail('');
      setIsLoggedIn(true);
      setIsAuthLoading(false);
      return;
    }

    if (!isFirebaseConfigured()) {
      setIsAuthLoading(false);
      return;
    }
    const auth = getFirebaseAuth();
    if (!auth) {
      setIsAuthLoading(false);
      return;
    }

    const unsubRef = { current: null };
    (async () => {
      // スマホでリダイレクト認証から戻った直後は、先に getRedirectResult を処理する
      await handleRedirectResult();
      unsubRef.current = onAuthStateChanged(auth, (user) => {
        setAuthError('');
        if (!user) {
          setCurrentUser('');
          setCurrentUserEmail('');
          setIsLoggedIn(false);
          setIsAuthLoading(false);
          return;
        }
        const allowed = getAllowedEmails();
        if (allowed && allowed.length > 0) {
          const email = (user.email || '').toLowerCase();
          if (!email || !allowed.includes(email)) {
            firebaseSignOut();
            setAuthError('このアカウントではログインできません。管理者にお問い合わせください。');
            setIsAuthLoading(false);
            return;
          }
        }
        setCurrentUser(user.displayName || user.email || 'ログインユーザー');
        setCurrentUserEmail(user.email || '');
        setIsLoggedIn(true);
        setIsAuthLoading(false);
        // 過去ログインユーザー一覧（目安箱の送り先リスト）用に Firestore に記録
        if (isFirebaseConfigured() && user.email) {
          const email = (user.email || '').toLowerCase();
          const docId = email.replace(/\//g, '_');
          upsertDocument('users', docId, {
            email,
            displayName: user.displayName || user.email || email,
            lastLoginAt: new Date().toISOString()
          }).catch(() => {});
        }
      });
    })();
    return () => {
      if (unsubRef.current && typeof unsubRef.current === 'function') unsubRef.current();
    };
  }, []);

  const handleSignIn = async () => {
    if (!isFirebaseConfigured()) {
      setAuthError('Firebaseの設定がありません。.env に VITE_FIREBASE_* を設定してください。');
      return;
    }
    setIsSignInLoading(true);
    setAuthError('');
    try {
      await signInWithGoogle();
    } finally {
      setIsSignInLoading(false);
    }
  };

  const handleLogout = async () => {
    if (isFirebaseConfigured()) await firebaseSignOut();
    setCurrentUser('');
    setIsLoggedIn(false);
    setAuthError('');
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <LoginScreen
        authError={authError}
        isLoading={isSignInLoading}
        onSignIn={isFirebaseConfigured() ? handleSignIn : () => { setCurrentUser('ログインユーザー'); setIsLoggedIn(true); }}
      />
    );
  }
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  return (
    <>
      {isDemoMode && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-yellow-400 text-gray-900 text-center py-1.5 text-sm font-medium shadow" style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top))' }}>
          デモ用のデモ版です
        </div>
      )}
      <div style={isDemoMode ? { paddingTop: 'calc(2.5rem + env(safe-area-inset-top))' } : undefined}>
        {isNfcStandalone ? (
          <NfcStandalonePage currentUser={currentUser} onLogout={handleLogout} nfcTaskId={nfcTaskId} nfcBinderNumber={nfcBinderNumber} />
        ) : (
          <KanbanApp currentUser={currentUser} currentUserEmail={currentUserEmail} onLogout={handleLogout} nfcTaskId={nfcTaskId} />
        )}
      </div>
      {import.meta.env.DEV && (
        <DevSeedPanel
          currentUser={currentUser}
          currentUserEmail={currentUserEmail}
          onLogout={handleLogout}
        />
      )}
    </>
  );
}

function DevSeedPanel({ currentUser, currentUserEmail, onLogout }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const handleSeed = async () => {
    if (!window.confirm('デモカード8枚を boards/main/tasks に追加します。本番Firestoreに書き込まれます。続行しますか？')) return;
    setBusy(true);
    setMsg('');
    try {
      const { inserted } = await seedDemoCards();
      setMsg(`✓ ${inserted}枚 追加`);
    } catch (e) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  const handleClear = async () => {
    if (!window.confirm('t-demo-* の全カードを削除します（写真サブコレクションは残ります）。続行しますか？')) return;
    setBusy(true);
    setMsg('');
    try {
      const { deleted } = await clearDemoCards();
      setMsg(`✓ ${deleted}枚 削除`);
    } catch (e) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  const handleSignout = async () => {
    if (typeof onLogout === 'function') await onLogout();
    // 強制ログイン画面に遷移
    window.location.href = '/?forceLogin=1';
  };
  const isAuthed = !!(currentUser && currentUserEmail);
  return (
    <div className="fixed bottom-4 right-4 z-[200] bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-xs space-y-2 max-w-[260px]">
      <div className="font-semibold text-gray-700">🌱 DEV: デモカード</div>
      <div className="text-[11px] leading-tight space-y-0.5 border-t border-gray-200 pt-2">
        <div className="text-gray-500">ログイン:</div>
        <div className={isAuthed ? 'text-emerald-700 font-mono break-all' : 'text-amber-600'}>
          {isAuthed ? currentUserEmail : `未認証 (${currentUser || 'なし'})`}
        </div>
        <div className="text-gray-500 pt-0.5">user: {currentUser || '(empty)'}</div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={handleSeed}
          className="flex-1 px-2 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium"
        >
          追加(8)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleClear}
          className="flex-1 px-2 py-1.5 rounded bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium"
        >
          削除
        </button>
      </div>
      <button
        type="button"
        onClick={handleSignout}
        className="w-full px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px]"
      >
        🔄 サインアウト → 再ログイン
      </button>
      {msg && <div className="text-xs text-gray-600 break-all">{msg}</div>}
    </div>
  );
}
