# 清田自動車 工程管理アプリ — Xserver デプロイ手順

このドキュメントは、本番環境構築手順書の **「3.5 オプションE: Xserver」** を、このプロジェクト用にまとめた手順です。  
**main ブランチに push するたびに、自動でビルドして Xserver にアップロード**されます。

---

## 目次

1. [FTPアカウント情報の確認](#1-ftpアカウント情報の確認)
2. [公開する場所を決める](#2-公開する場所を決める)
3. [GitHub の Secrets に FTP 情報を登録する](#3-github-の-secrets-に-ftp-情報を登録する)
4. [.htaccess とワークフローについて](#4-htaccess-とワークフローについて)
5. [main に push して動作確認する](#5-main-に-push-して動作確認する)
6. [手動でアップロードする場合](#6-手動でアップロードする場合)
7. [サブフォルダで公開する場合](#7-サブフォルダで公開する場合)

---

## 1. FTPアカウント情報の確認

Xserver のサーバーパネル → **FTPアカウント設定** で、次のどちらか（または両方）を確認します。

### メインのFTPアカウント（初期FTP）

| 項目 | 値 |
|------|-----|
| FTPサーバー（ホスト）名 | `sv16802.xserver.jp` |
| ユーザー（アカウント）名 | `withbt` |
| パスワード | サーバーパスワードと同じ値 |

### 追加したFTPアカウント

| 項目 | 値 |
|------|-----|
| FTPサーバー（ホスト）名 | `sv16802.xserver.jp` |
| ユーザー（アカウント）名 | FTPアカウントに設定したユーザーID（**@以降も含む**） |
| パスワード | 追加FTP用に設定したパスワード |

※ パスワードは **GitHub の Secrets にだけ登録**し、このMDファイルやリポジトリには絶対に書かないでください。

---

## 2. 公開する場所を決める

- **ドメイン直下**（例: `https://あなたのドメイン/`）に出す  
  → `FTP_REMOTE_DIR` は **`public_html/`**（末尾の `/` 必須）
- **サブフォルダ**（例: `https://あなたのドメイン/kiyota/`）に出す  
  → `FTP_REMOTE_DIR` は **`public_html/kiyota/`** など（末尾の `/` 必須）

決めた値は、次のステップで GitHub の Secret `FTP_REMOTE_DIR` に入れます。

---

## 3. GitHub の Secrets に FTP 情報を登録する

1. GitHub でこのプロジェクトのリポジトリを開く。
2. **Settings** → **Secrets and variables** → **Actions**
3. **New repository secret** で、次の4つを追加する。

| Secret 名 | 値 | 説明 |
|-----------|-----|------|
| `FTP_SERVER` | `sv16802.xserver.jp` | FTP のホスト名 |
| `FTP_USERNAME` | `withbt` または 追加FTPのユーザーID（@以降も含む） | 使うFTPアカウントのユーザー名 |
| `FTP_PASSWORD` | メインFTPならサーバーパスワード、追加FTPならそのパスワード | FTP パスワード |
| `FTP_REMOTE_DIR` | `public_html/` または `public_html/kiyota/` など（**末尾は必ず `/`**） | アップロード先のリモートパス（[2. 公開する場所](#2-公開する場所を決める)で決めた値） |

※ パスワードは Secrets にだけ入力し、リポジトリ内のファイルには記載しないこと。

---

## 4. .htaccess とワークフローについて

- **`.github/workflows/deploy-xserver.yml`**  
  - すでにリポジトリに含まれています。  
  - `main` に push すると、ビルド後に `dist` の中身を `FTP_REMOTE_DIR` に FTP アップロードします。
- **`public/.htaccess`**  
  - SPA 用の設定が入っており、`npm run build` で **`dist`** にコピーされます。  
  - リロードや直リンクでも `index.html` に振り向くため、Xserver 側で追加設定は不要です。

---

## 5. main に push して動作確認する

1. ローカルで変更をコミットし、**main ブランチ**に push する。
2. GitHub の **Actions** タブで **「Deploy to Xserver」** が実行され、緑で成功するか確認する。
3. ブラウザで次のURLを開き、工程管理アプリが表示されるか確認する。
   - ルートで公開した場合: `https://あなたのドメイン/`
   - サブフォルダで公開した場合: `https://あなたのドメイン/kiyota/` など

以降は、**コードを直したら main に push するだけ**で、自動で Xserver に反映されます。

---

## 6. 手動でアップロードする場合

自動デプロイを使わず、手元でビルドして FTP で上げる場合の手順です。

1. 手元で次を実行する。  
   `npm ci` → `npm run build`
2. **`dist` フォルダの中身**（`index.html` と `assets` など）を、FTP クライアント（FileZilla、WinSCP など）で Xserver に接続し、**public_html**（または公開したいサブフォルダ）にそのままアップロードする。
3. サブフォルダに置く場合は、あらかじめ **`vite.config.js`** で `base: '/フォルダ名/'` を設定してからビルドする。

`public/.htaccess` はビルド時に `dist` に含まれるため、手動アップロード時も一緒に上がります。

---

## 7. サブフォルダで公開する場合

例: `https://あなたのドメイン.com/kiyota/` で公開する場合。

1. **`vite.config.js`** で `base` を設定する。

   ```javascript
   import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'

   export default defineConfig({
     plugins: [react()],
     base: '/kiyota/',   // サブフォルダ名に合わせる
   })
   ```

2. GitHub の Secret **`FTP_REMOTE_DIR`** を `public_html/kiyota` のように、同じフォルダ名にする。
3. ビルドして push する（または手動で `dist` を `public_html/kiyota` にアップロードする）。

`public/.htaccess` をサブフォルダ用に変える場合は、次のように書き換える。

```apache
RewriteEngine On
RewriteBase /kiyota/
RewriteRule ^index\.html$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /kiyota/index.html [L]
```

---

## まとめ

| やること | 内容 |
|----------|------|
| FTP 情報 | メイン or 追加FTP のホスト名・ユーザー名・パスワードを確認 |
| 公開場所 | ルートなら `public_html`、サブフォルダなら `public_html/フォルダ名` |
| GitHub | Settings → Secrets and variables → Actions で `FTP_SERVER` / `FTP_USERNAME` / `FTP_PASSWORD` / `FTP_REMOTE_DIR` を登録 |
| デプロイ | `main` に push すると自動でビルド・アップロードされる |

詳細やトラブル時は、**本番環境構築手順書.md** の「3.5 オプションE: Xserver」も参照してください。
