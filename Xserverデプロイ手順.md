# 清田自動車 工程管理アプリ — Xserver デプロイ手順

このドキュメントは、本番環境構築手順書の **「3.5 オプションE: Xserver」** を、このプロジェクト用にまとめた手順です。  
**main ブランチに push するたびに、自動でビルドして Xserver にアップロード**されます。

---

## 目次

1. [FTPアカウント情報の確認](#1-ftpアカウント情報の確認)
2. [公開する場所を決める](#2-公開する場所を決める)
3. [GitHub の Secrets に FTP 情報を登録する](#3-github-の-secrets-に-ftp-情報を登録する)
4. [追加FTPアカウントでデプロイする場合（詳しい手順）](#4-追加ftpアカウントでデプロイする場合詳しい手順)
5. [.htaccess とワークフローについて](#5-htaccess-とワークフローについて)
6. [main に push して動作確認する](#6-main-に-push-して動作確認する)
7. [手動でアップロードする場合](#7-手動でアップロードする場合)
8. [サブフォルダで公開する場合](#8-サブフォルダで公開する場合)

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

## 4. 追加FTPアカウントでデプロイする場合（詳しい手順）

メインFTP（`withbt`）ではなく、**追加したFTPアカウント**で GitHub Actions からデプロイする手順です。追加FTPはアクセスできるフォルダを制限できるため、運用で使い分けたい場合に便利です。

### 4-1. Xserver で追加FTPアカウントを用意する

1. [Xserver サーバーパネル](https://www.xserver.jp/login_server.php) にログインする。
2. **「FTP」** または **「FTPアカウント設定」** を開く。
3. **「FTPアカウント追加」**（または「サブFTPアカウント設定」）を開く。
4. 次の項目を入力してアカウントを作成する。
   - **FTPユーザーID** … 英数字で任意のID（例: `brightboard`）。あとでログインに使う「ユーザー名」の一部になる。
   - **パスワード** … 追加FTP用のパスワード（例: `Prologue514`）。**このパスワードを控えておく。**
   - **接続先ディレクトリ** … このアカウントでアクセスできるフォルダだけにしたい場合は、例: `public_html/kiyota` のように指定する。**空欄の場合は public_html 以下すべて**にアクセス可能。
5. 作成後、**「FTPアカウント設定」一覧** または **「FTPソフト設定」** のタブで、**「FTPユーザー名（アカウント名）」** を確認する。

### 4-2. 追加FTPの「ユーザー名」を正確に確認する

追加FTPのログインで使う **ユーザー名** は、Xserver の画面に表示されているものを **そのまま** 使う必要があります。

- 多くの場合、**「FTPユーザーID@サーバー名」** のような形式です。  
  例: `brightboard@sv16802.xserver.jp`
- 表示が **「ユーザーID（@以降も含む）」** と書いてある場合は、**@ より後ろも含めた文字列全体**がユーザー名です。
- **必ず Xserver の「FTPアカウント設定」や「FTPソフト設定」に表示されている値をコピー**し、余計なスペースを付けずに使ってください。

### 4-3. GitHub の Secrets に追加FTPの情報を入れる

1. GitHub のリポジトリ（例: **izumicoinzoom-hash/brightboard**）を開く。
2. **Settings** → **Secrets and variables** → **Actions** を開く。
3. 次の4つの Secret を、**追加FTP用の値**で設定・更新する。

| Secret 名 | 入れる値 | 注意 |
|-----------|----------|------|
| `FTP_SERVER` | `sv16802.xserver.jp` | メインと同じ。**ftp. は付けない。** |
| `FTP_USERNAME` | Xserver に表示されている**ユーザー名をそのまま**（例: `brightboard@sv16802.xserver.jp`） | コピー＆ペーストで、前後にスペースを入れない。 |
| `FTP_PASSWORD` | 追加FTP用に設定したパスワード（例: `Prologue514`） | 手入力またはコピー。前後にスペースを入れない。 |
| `FTP_REMOTE_DIR` | 接続先にするフォルダ（末尾に `/` を付ける） | 接続先を制限している場合はそのパス（例: `public_html/kiyota/`）。制限していない場合は `public_html/`。 |

4. 各 Secret の **Update** で上書き保存する。値は **1行で**、**先頭・末尾にスペースや改行がないこと**を確認する。

### 4-4. 接続先ディレクトリを制限している場合の FTP_REMOTE_DIR

- 追加FTPの「接続先ディレクトリ」を **空欄** にした場合  
  → **FTP_REMOTE_DIR** は `public_html/` または `public_html/kiyota/` など、通常どおり指定する。
- 「接続先ディレクトリ」に **`public_html/kiyota`** のように指定した場合  
  → そのアカウントはそのフォルダ以下にしか入れないので、**FTP_REMOTE_DIR** は `public_html/kiyota/` のように、**そのフォルダ**を指定する（末尾は `/`）。

### 4-5. 530 Login incorrect が出たときの確認ポイント

- **FTP_USERNAME** が Xserver の「FTPユーザー名」と **完全に一致**しているか（@ 以降も含む）。
- **FTP_PASSWORD** に余計なスペースや改行が入っていないか。
- **FTP_SERVER** が `sv16802.xserver.jp` で、`ftp.` が付いていないか。

ここまで設定したうえで、**Actions** の「Re-run all jobs」または **main に push** してデプロイを再実行してください。

---

## 5. .htaccess とワークフローについて

- **`.github/workflows/deploy-xserver.yml`**  
  - すでにリポジトリに含まれています。  
  - `main` に push すると、ビルド後に `dist` の中身を `FTP_REMOTE_DIR` に FTP アップロードします。
- **`public/.htaccess`**  
  - SPA 用の設定が入っており、`npm run build` で **`dist`** にコピーされます。  
  - リロードや直リンクでも `index.html` に振り向くため、Xserver 側で追加設定は不要です。

---

## 6. main に push して動作確認する

1. ローカルで変更をコミットし、**main ブランチ**に push する。
2. GitHub の **Actions** タブで **「Deploy to Xserver」** が実行され、緑で成功するか確認する。
3. ブラウザで次のURLを開き、工程管理アプリが表示されるか確認する。
   - ルートで公開した場合: `https://あなたのドメイン/`
   - サブフォルダで公開した場合: `https://あなたのドメイン/kiyota/` など

以降は、**コードを直したら main に push するだけ**で、自動で Xserver に反映されます。

---

## 7. 手動でアップロードする場合

自動デプロイを使わず、手元でビルドして FTP で上げる場合の手順です。

1. 手元で次を実行する。  
   `npm ci` → `npm run build`
2. **`dist` フォルダの中身**（`index.html` と `assets` など）を、FTP クライアント（FileZilla、WinSCP など）で Xserver に接続し、**public_html**（または公開したいサブフォルダ）にそのままアップロードする。
3. サブフォルダに置く場合は、あらかじめ **`vite.config.js`** で `base: '/フォルダ名/'` を設定してからビルドする。

`public/.htaccess` はビルド時に `dist` に含まれるため、手動アップロード時も一緒に上がります。

---

## 8. サブフォルダで公開する場合

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
