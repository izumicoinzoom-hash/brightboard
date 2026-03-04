# ブライトボード デモ用URLの作り方

他社への販売・紹介用に、**本番データと分離したデモ用のURL（ページ）**を用意する手順です。

---

## 1. デモ用のサーバーURL

デモ用ビルドを配置すると、次のURLでアクセスできます。

- **例**: `https://あなたのドメイン/kiyota/demo/`

画面上部に「デモ環境 — 表示データは実運用データと共有されません」のバナーが表示され、本番と区別できます。

---

## 2. 準備するもの

- **デモ用 Firebase プロジェクト**（本番とは別プロジェクトを推奨）
  - [Firebase Console](https://console.firebase.google.com/) で新規プロジェクトを作成（例: `brightboard-demo`）
  - **Authentication** を有効化し、Google ログインを設定
  - **Firestore Database** を有効化（本番と同じルールでOK。デモ用データのみ入れる）
- 必要に応じて、デモ用のサンプルタスク・列設定を Firestore に投入

---

## 3. デモ用ビルドの手順

### 3.1 デモ用の環境変数ファイルを作成

1. リポジトリ内の **`.env.demo.example`** をコピーし、**`.env.demo`** という名前で保存します。
2. **`.env.demo`** を開き、デモ用 Firebase の値を埋めます。
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
3. **`VITE_BASE_PATH`** は `/kiyota/demo/` のままで問題ありません（デモ用URLのパス）。
4. **`VITE_ALLOWED_EMAILS`** は、デモでは空のまま（どのGoogleアカウントでもログイン可）にすることが多いです。

※ `.env.demo` は Git に含めず、ローカルのみで使用してください（必要なら `.gitignore` に `.env.demo` を追加）。

### 3.2 デモ用ビルドを実行

```bash
npm run build:demo
```

成功すると **`dist/`** フォルダに、パス `/kiyota/demo/` 用のファイルが出力されます。

### 3.3 サーバーにアップロード

- **Xserver など**  
  `dist/` の中身を、**`public_html/kiyota/demo/`** にアップロードします。  
  （`dist/index.html` や `dist/assets/` などを、そのまま `demo/` 配下に置くイメージです。）
- **GitHub などでデプロイしている場合**  
  デモ用ビルドだけ別ブランチや別ワークフローでデプロイし、`/kiyota/demo/` に出す方法もあります。

---

## 4. 動作確認

1. ブラウザで `https://あなたのドメイン/kiyota/demo/` を開く。
2. 画面上部に「デモ環境」のバナーが出ていることを確認。
3. Google でログインし、カンバン・代車などが表示されることを確認。
4. 本番の `/kiyota/` とは別の Firebase プロジェクトに接続されているため、**本番データは変更されません**。

---

## 5. まとめ

| 項目 | 本番 | デモ |
|------|------|------|
| URL例 | `https://ドメイン/kiyota/` | `https://ドメイン/kiyota/demo/` |
| ビルドコマンド | `npm run build` | `npm run build:demo` |
| 環境変数 | `.env` | `.env.demo` |
| Firebase | 本番プロジェクト | デモ用プロジェクト（推奨） |
| 画面上の区別 | なし | 「デモ環境」バナー表示 |

デモ用 Firebase にサンプルデータを入れておけば、見せたい状態で固定したデモが用意できます。
