# 東海の日 NFCプロフィール帳

メンターの NFC カードを Android 版 Chrome で読み取り、プロフィールを集めるイベント用 Web アプリです。画面は静的な GitHub Pages、公開用のメンターデータは Firebase Firestore、各参加者が集めた履歴はその端末だけの LocalStorage に保存します。

## この構成を選んだ理由

| 役割 | 採用技術 | 無料で運用できる理由 |
| --- | --- | --- |
| Web画面 | React + Vite | 速く軽量な静的サイトを作れる |
| 公開 | GitHub Pages | 静的ファイルのホスティングが無料。独自ドメインなしでも HTTPS を利用可能 |
| メンターデータ | Firebase Firestore（Spark プラン） | ブラウザから Firebase SDK で直接、読み取り専用データを取得できる |
| 収集履歴 | LocalStorage | ユーザー登録・サーバー不要。端末内にだけ残る |
| NFC | Web NFC API | Android Chrome が HTTPS ページで標準提供する API。アプリのインストール不要 |

Firestore の無料枠（Spark）は読み取り 50,000 回/日です。プロフィール一覧は初回表示でメンター人数ぶんの read を使うため、50 人なら目安は 1,000 回の初回表示/日です。通常規模のイベントでは十分ですが、枠・規約は Firebase コンソールで開催前に確認してください。GitHub Pages と Firebase は「無料枠を超えない」限り課金設定なしで運用できます。

> **大切な設計上の注意**: このアプリはログインを持たないため、プロフィール画像 URL はブラウザへ配信されます。「未獲得」を画面上で隠す演出であり、機密情報のアクセス制御ではありません。画像・プロフィールには公開して問題ない内容だけを入れてください。

## 1. 事前に必要なもの

- Google アカウント（Firebase 用）
- GitHub アカウント（GitHub Pages 用）
- NFC 対応 Android 端末と最新版 Chrome（実機テスト用）
- NFC カードへ URL を書き込めるアプリ

PC のローカル環境には Node.js 20 以降を用意します。Node.js を入れた後、最初の一度だけ `corepack enable` を実行して pnpm を使えるようにします。

## 2. ローカルで起動する

1. このフォルダで依存パッケージを入れます。

   ```bash
   pnpm install
   ```

2. `.env.example` をコピーして `.env.local` を作ります。

   ```bash
   cp .env.example .env.local
   ```

3. 次節で取得する Firebase の値を `.env.local` の空欄に貼り付けます。

4. 開発サーバーを起動し、表示された URL をブラウザで開きます。

   ```bash
   pnpm dev
   ```

5. 完成版のビルド確認は次です。

   ```bash
   pnpm build
   ```

`.env.local` は Git に追加しません。Firebase 設定値はクライアントに含まれる値ですが、誤って API キーに権限を与えないよう、後述の Firestore ルールを必ず設定します。

## 3. Firebase を準備する

### 3-1. プロジェクトと Firestore を作る

1. [Firebase コンソール](https://console.firebase.google.com/) で **プロジェクトを追加** を選びます。任意の名前（例: `tokai-nfc-profile-book`）を入力します。Google Analytics はこの用途では不要です。
2. プロジェクトの概要画面で Web アイコン `</>` を選び、アプリ名を入れて登録します。
3. 表示される `firebaseConfig` から以下を `.env.local` へ転記します。

   ```js
   apiKey              -> VITE_FIREBASE_API_KEY
   authDomain          -> VITE_FIREBASE_AUTH_DOMAIN
   projectId           -> VITE_FIREBASE_PROJECT_ID
   storageBucket       -> VITE_FIREBASE_STORAGE_BUCKET
   messagingSenderId   -> VITE_FIREBASE_MESSAGING_SENDER_ID
   appId               -> VITE_FIREBASE_APP_ID
   ```

4. 左メニューの **Firestore Database** から **データベースを作成** を選びます。ロケーションは参加者に近い `asia-northeast1`（東京）を推奨します。開始モードは後でルールを貼り替えるため、いったん選べる方で進めて構いません。

### 3-2. Firestore にデータを入れる

Firestore の **データ** タブで、次のように作成します。`mentors` の下のドキュメントIDは NFC URL の ID と完全に同じにしてください（例: `syokora`）。

```text
mentors （コレクション）
  syokora （ドキュメント）
    name: "ショコラ"
    generation: "18期"
    imageUrl: "https://.../syokora-profile.png"
  tarou （ドキュメント）
    name: "タロウ"
    generation: "OB・OG"
    imageUrl: "https://.../tarou-profile.png"

appConfig （コレクション）
  settings （ドキュメント）
    isAllOpen: false （boolean）
```

- `name`、`generation`、`imageUrl` はすべて文字列です。
- 世代名は `OB・OG`、`13期` から `18期` のように入れるとその順で並びます。`OB` / `OG` も使えます。
- 画像 URL は、イベント中に誰でも画像を読める安定した HTTPS URL を使います。Firebase Storage を使う場合は、アップロード済み画像のダウンロード URL を入れてください。
- `appConfig/settings` を作り忘れると、全開放は安全側（`false`）で動作します。

### 3-3. ルールを安全にする

1. Firestore の **ルール** タブを開きます。
2. このリポジトリの [firestore.rules](./firestore.rules) の内容で置き換え、**公開** を押します。

このルールでは参加者は `mentors` と `appConfig/settings` を読むだけで、追加・変更・削除はできません。運営者は Firebase コンソールから管理者としてデータを編集できます。

## 4. NFC カードへ書き込む

NFC 書込アプリで **URL / URI** レコードを選び、メンターごとに次の形式で書き込みます。

```text
https://nagoya-mentors.com/mentor/syokora
```

- ドメインはこのアプリの公開 URL と違っていても構いません。アプリは画面遷移せず、`/mentor/` の後ろの `syokora` だけを使います。
- `https://example.com/anything/syokora` のように ID が URL の最後にある形式、`?id=syokora` も読めます。
- ID は半角英数字、ハイフン、アンダースコアだけにしてください。
- NFC の URL をスマホが勝手に開くことがあるため、参加者には「先にプロフィール帳を Chrome で開き、NFCを読み取る を押してから、カードにかざす」と案内してください。

## 5. GitHub Pages へ無料デプロイする

### 5-1. GitHub リポジトリを作る

1. GitHub で空のリポジトリを作ります（例: `tokai-nfc-profile-book`）。
2. このプロジェクトを commit して `main` ブランチへ push します。

   ```bash
   git init
   git add .
   git commit -m "Create NFC profile book"
   git branch -M main
   git remote add origin https://github.com/＜アカウント名＞/＜リポジトリ名＞.git
   git push -u origin main
   ```

### 5-2. Firebase の値を GitHub に登録する

1. GitHub リポジトリの **Settings > Secrets and variables > Actions > Variables** を開きます。
2. 次の 6 個を Repository variables として追加します。値は `.env.local` と同じ Firebase 設定です。

   ```text
   VITE_FIREBASE_API_KEY
   VITE_FIREBASE_AUTH_DOMAIN
   VITE_FIREBASE_PROJECT_ID
   VITE_FIREBASE_STORAGE_BUCKET
   VITE_FIREBASE_MESSAGING_SENDER_ID
   VITE_FIREBASE_APP_ID
   ```

ここでは **Secrets ではなく Variables** を使います。`VITE_` で始まる値はビルド後の JavaScript に含まれるため、隠せる秘密情報ではないからです。安全性は Firestore ルールで守ります。

### 5-3. Pages を有効化する

1. **Settings > Pages** を開きます。
2. **Build and deployment** の Source で **GitHub Actions** を選びます。
3. `main` へ push すると `.github/workflows/deploy.yml` がビルド・公開します。
4. **Actions** タブで `Deploy to GitHub Pages` が緑のチェックになったら、表示された URL を開きます。通常は `https://＜アカウント名＞.github.io/＜リポジトリ名＞/` です。

公開後は GitHub Pages の HTTPS URL を使うため、Web NFC の HTTPS 条件も満たします。`main` に更新を push するたび自動で再公開されます。

## 6. 開催前・当日の確認

1. 公開 URL を **Android の Chrome** で開きます（iPhone の Safari / Chrome は Web NFC 非対応です）。
2. `NFCを読み取る` を押して NFC 使用を許可し、テストカードをかざします。
3. モーダルが表示され、再読み込み後にも対象メンターがカラー表示のままか確認します。
4. Chrome のサイトデータを消すと履歴も消えます。端末・ブラウザごとに別のコレクションです。
5. 会場 Wi-Fi が不安定な場合に備え、モバイル回線でも一度試します。プロフィール一覧とカード読取後の最新プロフィールを Firestore から読むため、初回は通信が必要です。

## 7. 終了後の全開放

管理画面はアプリにありません。Firebase コンソールの **Firestore Database > データ > `appConfig/settings`** で、`isAllOpen` を boolean の `true` に変更するだけです。

参加者がページを再読み込みすると、獲得履歴に関係なく全メンターがカラーになり、タップしてプロフィールを開けます。元に戻す場合は `false` に変更します。

## 主なソースコード

- [src/App.tsx](./src/App.tsx): 画面・進捗・Firestore読込・NFC成功後の収集処理
- [src/hooks/useNfcScanner.ts](./src/hooks/useNfcScanner.ts): Web NFC の `NDEFReader` 実装
- [src/lib/nfc.ts](./src/lib/nfc.ts): URL から ID を安全に抽出する処理
- [src/lib/mentors.ts](./src/lib/mentors.ts): Firestore の `mentors` / `appConfig` 連携
- [src/lib/collection.ts](./src/lib/collection.ts): LocalStorage の端末内収集履歴
- [src/components/ProfileModal.tsx](./src/components/ProfileModal.tsx): プロフィール画像のモーダル
