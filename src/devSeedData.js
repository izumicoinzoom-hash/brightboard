/**
 * BB鈑金版 開発用デモカード生成
 *
 * 本番 Firestore (`boards/main/tasks`) に書き込むため、ID に `t-demo-` プレフィックスを付けて
 * `clearDemoCards()` で一括削除可能にする。
 *
 * import.meta.env.DEV のときだけ App.jsx から呼ばれるユーティリティ。
 */
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirestoreDb } from './firebase';

const DEMO_PREFIX = 't-demo-';

/**
 * 8件の現実的なデモカード（Phase IN/B/P/OUT を網羅できる配置）
 */
function buildDemoCards() {
  const today = new Date().toISOString().slice(0, 10);
  const baseDots = ['white', 'white', 'white', 'white'];

  const cards = [
    {
      slug: 'yamada-prius-1234',
      status: 'received',
      maker: 'トヨタ',
      car: 'プリウス',
      colorNo: '3R2',
      number: '1234',
      assignee: '山田太郎',
    },
    {
      slug: 'sato-note-5678',
      status: 'b_wait',
      maker: '日産',
      car: 'ノート',
      colorNo: 'KH3',
      number: '5678',
      assignee: '佐藤花子',
    },
    {
      slug: 'kojin-nakajima-aqua-9012',
      status: 'b_wait',
      maker: 'トヨタ',
      car: 'アクア',
      colorNo: '040',
      number: '9012',
      assignee: '個人 中島',
    },
    {
      slug: 'maruko-nbox-3456',
      status: 'b_doing',
      maker: 'ホンダ',
      car: 'N-BOX',
      colorNo: 'NH731P',
      number: '3456',
      assignee: '株式会社マルコー',
    },
    {
      slug: 'suzuki-demio-7890',
      status: 'b_doing',
      maker: 'マツダ',
      car: 'デミオ',
      colorNo: '46G',
      number: '7890',
      assignee: '鈴木一郎',
    },
    {
      slug: 'tanaka-mira-2345',
      status: 'b_done_p_wait',
      maker: 'ダイハツ',
      car: 'ミライース',
      colorNo: 'W19',
      number: '2345',
      assignee: '田中工業',
    },
    {
      slug: 'kojin-takahashi-wagonr-6789',
      status: 'prep_done',
      maker: 'スズキ',
      car: 'ワゴンR',
      colorNo: 'ZWG',
      number: '6789',
      assignee: '個人 高橋',
    },
    {
      slug: 'watanabe-serena-4321',
      status: 'delivery_today',
      maker: '日産',
      car: 'セレナ',
      colorNo: 'QAB',
      number: '4321',
      assignee: '渡辺商店',
    },
  ];

  return cards.map((c, i) => ({
    id: `${DEMO_PREFIX}${c.slug}`,
    status: c.status,
    color: 'bg-white',
    maker: c.maker,
    car: c.car,
    colorNo: c.colorNo,
    number: c.number,
    assignee: c.assignee,
    inDate: today,
    inTime: '09:00',
    outDate: '',
    loanerType: 'none',
    loanerCarId: '',
    dots: [...baseDots],
    characters: [],
    tasks: [],
    statusEnteredAt: new Date().toISOString(),
    statusHistory: [],
    attachments: [],
    description: `[デモカード${i + 1}] Phase 1 写真撮影機能の動作検証用です。t-demo-* プレフィックスで識別。デモ削除ボタンで一括クリーン可能。`,
    isDemoCard: true,
  }));
}

/**
 * デモカードを Firestore に書き込む。
 * 既に同じ ID があれば merge 上書き。
 *
 * @returns {Promise<{ inserted: number }>}
 */
export async function seedDemoCards() {
  const db = getFirestoreDb();
  if (!db) throw new Error('Firestore not configured');
  const cards = buildDemoCards();
  for (const card of cards) {
    const ref = doc(db, 'boards/main/tasks', card.id);
    await setDoc(ref, { ...card, updatedAt: serverTimestamp() }, { merge: true });
  }
  return { inserted: cards.length };
}

/**
 * `t-demo-` で始まる全カードを削除する（写真サブコレクションは残るので注意）。
 *
 * @returns {Promise<{ deleted: number }>}
 */
export async function clearDemoCards() {
  const db = getFirestoreDb();
  if (!db) throw new Error('Firestore not configured');
  const colRef = collection(db, 'boards/main/tasks');
  const snap = await getDocs(colRef);
  let deleted = 0;
  for (const d of snap.docs) {
    if (d.id.startsWith(DEMO_PREFIX)) {
      await deleteDoc(d.ref);
      deleted += 1;
    }
  }
  return { deleted };
}
