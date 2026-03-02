## 清田自動車 工程管理アプリ Googleログイン設定手順（静的サイト版）

このドキュメントは、**特定の Google アカウントだけがログインできる簡易な仕組み**を、  
現在の静的フロントエンドのまま実験レベルで導入するための手順です。

> 注意: ここで説明する方法は **フロントエンドだけでメールアドレスを判定する簡易実装** です。  
> 本番運用で厳密な認証・認可を行う場合は、バックエンド側で ID トークン検証とメールアドレスチェックを行う構成が必要です。

---

## 1. 事前準備

- Google アカウント
- `withbt.com` ドメインで公開されている工程管理アプリ  
  （例: `https://withbt.com/kiyota/`）
- ローカル開発環境  
  - `npm install` 済み
  - `npm run dev` で `http://localhost:5173` で動作する状態

この手順では、次の2つの環境で Google ログインを動かします。

- **ローカル開発用**: `http://localhost:5173`
- **本番テスト用**: `https://withbt.com`（`/kiyota/` も同じオリジン）

---

## 2. Google Cloud で OAuth クライアントを作成

1. ブラウザで [Google Cloud Console](https://console.cloud.google.com/) にアクセスし、  
   工程管理アプリ用のプロジェクトを1つ用意する（既存プロジェクトでも可）。
2. 左メニューから **「APIとサービス」→「OAuth 同意画面」** を開き、まだ設定していなければ  \n
   ユーザータイプやアプリ名などを登録する（テストユーザーに自分の Google アカウントを追加しておくと安全）。
3. 左メニューから **「認証情報」** を開き、  
   **「認証情報を作成」→「OAuth クライアント ID」** をクリック。
4. アプリケーションの種類で **「ウェブアプリケーション」** を選択し、任意の名前を付ける。
5. **承認済みの JavaScript 生成元** に以下を追加する。

   - `http://localhost:5173`
   - `https://withbt.com`

   （`/kiyota/` で配信していても、オリジンはドメイン単位で指定する）

6. 作成後に表示される **「クライアント ID」** を控える。  \n
   例: `1234567890-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com`

---

## 3. index.html に Google Identity Services を読み込む

`index.html`（Vite のテンプレート。`dist` ではなくプロジェクト直下のもの）を編集します。

```html
<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BrightBoard - 清田自動車 工程管理</title>
    <!-- 追加: Google Identity Services SDK -->
    <script src="https://accounts.google.com/gsi/client" async defer></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

保存後、`npm run dev` を再起動しておくとよいです。

---

## 4. ログイン画面に Google ログインボタンを組み込む

`src/App.jsx` には既に `LoginScreen` コンポーネントがあります（Google ログイン風のボタンがあるだけ）。  \n
これを実際の Google ログイン処理に置き換えます。

### 4-1. 許可するメールアドレスを定義

`App.jsx` の上部（`APP_NAME` の近く）に、許可対象のメールアドレスを定数として追加します。

```js
// --- アプリ名（看板ボードのタイトルなどで使用）---
const APP_NAME = 'BrightBoard';

// --- Googleログインで許可するメールアドレス ---
const ALLOWED_GOOGLE_EMAIL = 'your.account@example.com'; // 実際のGoogleアカウントに置き換える
```

### 4-2. LoginScreen を Google Identity Services 対応にする

`LoginScreen` を次のようなイメージに変更します（実装の参考用コード）。

```jsx
function LoginScreen({ onLogin }) {
  useEffect(() => {
    if (!window.google) return;

    window.google.accounts.id.initialize({
      client_id: 'あなたのクライアントIDをここに貼る',
      callback: (response) => {
        try {
          const [, payloadBase64] = response.credential.split('.');
          const json = JSON.parse(
            atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'))
          );
          const email = json.email;

          if (email === ALLOWED_GOOGLE_EMAIL) {
            onLogin(email); // App 側にログイン成功を通知
          } else {
            alert('このGoogleアカウントではログインできません。');
          }
        } catch (e) {
          console.error('Googleログインの解析に失敗しました', e);
          alert('ログインに失敗しました。もう一度お試しください。');
        }
      },
    });

    window.google.accounts.id.renderButton(
      document.getElementById('google-signin-button'),
      { theme: 'outline', size: 'large', width: '100%' }
    );
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-8 rounded shadow-sm border border-gray-200">
        <h1 className="text-2xl font-bold text-center mb-6 text-gray-800">ログイン</h1>
        <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-8 flex items-start gap-3">
          <AlertTriangle className="text-orange-500 w-5 h-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-700">
            このページにアクセスするには許可された Google アカウントでログインする必要があります。
          </p>
        </div>
        {/* Google ボタンを描画するコンテナ */}
        <div id="google-signin-button" className="w-full flex justify-center" />
      </div>
    </div>
  );
}
```

ポイント:

- `client_id` には **2章で取得したクライアントID** をそのまま入れる。
- `ALLOWED_GOOGLE_EMAIL` と一致するメールアドレスだけ `onLogin(email)` を呼び出す。
- 一致しない場合はアラートを出してログインさせない。

`onLogin` の引数は `App` で `currentUser` のような state に保存しておくと、ヘッダー等に「ログイン中: xxx@example.com」と表示できます。

---

## 5. App 側のログイン状態管理（概要）

`App` コンポーネント側では、すでに `LoginScreen` とメイン画面の切り替えが実装されています。  \n
（例: `const [isLoggedIn, setIsLoggedIn] = useState(false);` など）

Google ログイン対応後は、次のように `onLogin` でメールアドレスを受け取り、ログイン状態を更新します。

```jsx
function App() {
  const [currentUser, setCurrentUser] = useState(null);

  if (!currentUser) {
    return <LoginScreen onLogin={(email) => setCurrentUser(email)} />;
  }

  // ここから下がメインのボード画面
  return (
    <div className="...">
      {/* currentUser をヘッダーなどで使える */}
    </div>
  );
}
```

こうしておくと、許可された Google アカウントでログインしたときだけアプリ本体が表示されます。

---

## 6. 動作確認手順

1. ローカルで

   ```bash
   npm run dev
   ```

   を実行し、ブラウザで `http://localhost:5173` を開く。

2. ログイン画面に Google ボタンが表示されることを確認し、  \n
   許可したメールアドレスでログインできるかをテストする。
3. 許可していないメールアドレスでログインした場合は、アラートが出てアプリに入れないことを確認。
4. 問題なければ `npm run build` → GitHub へ push → Xserver へ自動デプロイ。  \n
   `https://withbt.com/kiyota/` で同様に動作するか確認する。

---

## 7. 将来的な発展（メモ）

- 本番運用する場合は、**バックエンドで ID トークンの署名と `aud`（client_id）、`iss` を検証**し、メールアドレスをチェックする必要があります。
- Firebase Authentication や Supabase Auth を使うと、バックエンド側の検証とセッション管理を簡単に構築できます。
- いまのコードは「誰かが JS を書き換えれば回避できる」レベルなので、**あくまで社内実験・テスト環境向け**として利用してください。

