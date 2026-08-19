# 東海の日 QRプロフィール帳

東海の日のメンター交流で使う、QRコード式のプロフィール収集Webアプリです。

既存のNFCカードとプロフィールURLには一切変更を加えません。NFCカードは従来どおり自己紹介プロフィールを開く用途で使い、イベント用に別途配布するQRコードをプロフィール帳の収集に使います。iPhone / Android のSafari・Chromeで動作します。

## 構成

| 役割 | 技術 | 使い方 |
| --- | --- | --- |
| 画面・QR読取り | React + Vite + カメラAPI | 参加者がアプリ内のカメラでQRを読む |
| 公開 | GitHub Pages | HTTPS付きの静的サイトとして無料公開 |
| メンターデータ・QR紐付け | Firebase Firestore | 一覧アイコン、プロフィール画像、QR在庫、初回登録を管理 |
| 端末識別 | Firebase Authentication（匿名認証） | ログインなしで端末ごとのUIDを作る |
| 獲得履歴 | LocalStorage | 参加者の端末だけに保存 |
| 一括管理 | Node.js管理コマンド + Excel | Excelからメンター・QR在庫を一括作成 |

## イベントでの流れ

### メンター本人のQR初回登録

1. メンター本人がプロフィール帳を初めて開きます。
2. 自分の名前を選択します。
3. 手元にランダム配布されたイベントQRをカメラで読み取ります。
4. Firestoreに「このQRは、このメンターのもの」という関係が一度だけ作成され、本人のプロフィールも自動で獲得済みになります（画像ポップアップは開きません）。

`その他` を選ぶと、QRの所有者登録はせず、収集機能だけを使う端末として初期設定されます。

### 参加者の収集

1. プロフィール帳で `QRを読み取る` を押します。
2. カメラ利用を許可します。
3. メンターのイベントQRを読み取ります。
4. プロフィール帳用の画像が表示され、獲得済みとして端末に保存されます。一覧では顔アイコンがカラー表示になります。

QRを読むために既存NFCカードのURL、既存プロフィールサイト、Chrome履歴へアクセスすることはありません。

## Firestoreの構造

```text
mentors/{mentorId}                 # 管理者がExcelから作成
  name
  generation
  iconUrl                           # 一覧に表示する正方形の顔アイコン
  imageUrl

qrInventory/{qrId}                 # 管理者が事前発行。ブラウザから読めない
  active: true
  issuedAt

qrCodes/{qrId}                     # メンター本人の初回登録で作成
  mentorId
  registeredByUid
  registeredAt

mentorQrBindings/{mentorId}        # メンター1人につきQRは1枚
  qrId
  registeredByUid
  registeredAt

deviceSetups/{anonymousAuthUid}    # 端末の初期設定。作成後は変更不可
  ownerType: "mentor" | "other"
  mentorId?                        # mentor の場合だけ
  qrId?                            # mentor の場合だけ
  createdAt

appConfig/settings
  isAllOpen: false
  collectionEpoch: 1                # 獲得履歴を一括リセットする世代番号
```

FirestoreはスキーマをConsoleで1件ずつ定義する必要はありません。後述の管理コマンドが `mentors`、`qrInventory`、`appConfig/settings` を初回作成します。残りの3コレクションは、メンター本人の初回登録時に自動作成されます。

## 1. 初期設定（最初に一度だけ）

### Firestoreを有効にする

1. [Firebaseコンソール](https://console.firebase.google.com/) でプロジェクトを作成します。
2. Webアプリを登録し、表示されたFirebase設定を控えます。後でGitHub ActionsのVariablesへ登録します。
3. **Firestore Database** でデータベースを作成します。ロケーションは `asia-northeast1`（東京）を推奨します。

### 匿名認証を有効にする

1. Firebaseコンソールの **Authentication** を開きます。
2. **Sign-in method** で **匿名** を有効にします。
3. GitHub Pages公開後、Authenticationの **Settings > Authorized domains** に `GitHubユーザー名.github.io` を追加します。カスタムドメインを使う場合は、そのドメインも追加します。

匿名認証は参加者にメールアドレスやパスワードを求めません。Firestoreルールが、端末ごとのQR初回登録を制限するためだけに使います。

### Firestoreルールの自動反映を設定する

GitHub Actionsからルールを反映するため、Google Cloudの **IAMと管理 > サービスアカウント** でデプロイ専用のサービスアカウントを作成し、プロジェクトのIAMで次の2つのロールを付与します。

- **Firebase Rules Admin**（`roles/firebaserules.admin`）— Firestoreルールを反映する権限
- **Service Usage Viewer**（`roles/serviceusage.serviceUsageViewer`）— Firebase CLIがFirestore APIの有効状態を確認する権限

作成したJSON鍵の内容を、GitHubの **Settings > Secrets and variables > Actions > Secrets** に `FIREBASE_SERVICE_ACCOUNT_JSON` として登録してください。

JSON鍵は長期認証情報です。リポジトリやVariablesではなく、必ずSecretへ登録します。`.gitignore` でも除外済みです。

`firestore.rules` は以下を保証します。

- `mentors` と `isAllOpen` は読み取り専用
- QR在庫の一覧はブラウザから読めない
- QRの対応表は、ログイン済みの匿名ユーザーでもQR IDを指定した1件取得だけ
- メンター本人の初回登録は、QR・メンター・端末設定の3件を同時に作る場合だけ許可
- 登録後の変更・削除はブラウザから不可

> 名前選択だけでは本人確認になりません。物理QRを本人へ配布し、本人が登録操作をするイベント運用を前提にした設計です。誤登録は管理者コマンドで解除します。

## 2. 初期データ登録（イベント前に一度）

テンプレート [data/mentors.template.xlsx](./data/mentors.template.xlsx) をコピーして、イベント用のExcelを作ります。

| 列 | 必須 | 内容 |
| --- | --- | --- |
| `mentorId` | はい | 半角英数字・ハイフン・アンダースコア。以後変更しないID |
| `name` | はい | 表示名 |
| `generation` | はい | 例: `OB・OG`、`18期` |
| `iconUrl` | はい | 一覧用の顔アイコンURL。HTTPS、正方形の顔写真を推奨 |
| `imageUrl` | はい | HTTPSのプロフィール画像URL |
メンターのデータ行は見出し直後から連続して入力します。最初の空行より下は説明欄として扱われ、登録されません。

### サービスアカウントを用意する

Firebaseコンソールの **プロジェクトの設定 > サービスアカウント > 新しい秘密鍵の生成** でJSONをダウンロードします。たとえばプロジェクト外の安全な場所へ保存します。

この作業は、ExcelをFirestoreへ反映する管理者PCでのみ必要です。アプリをローカル起動して確認する必要はありません。Node.js 20以上を入れ、リポジトリ直下で一度だけ `pnpm install` を実行します。

PowerShellでは、作業中のターミナルでだけパスを設定します。

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\安全な場所\firebase-service-account.json"
```

このJSONは管理者権限を持ちます。GitHub・Google Driveの共有フォルダ・リポジトリへ保存しないでください。`.gitignore` でも除外済みです。

### 反映前の検証

```bash
pnpm admin:bootstrap -- --input ./data/mentors.xlsx --dry-run
```

必須項目、ID形式、重複、画像URLを検証します。FirestoreもQRファイルも変更しません。印刷・配布するQRは、次の `--apply` が完了してから出力されるものだけを使ってください。

### Firestoreへ反映

```bash
pnpm admin:bootstrap -- --input ./data/mentors.xlsx --apply
```

このコマンドが以下を一括作成・更新します。

- `mentors` のプロフィール
- メンター人数と同数の、未割当の共通 `qrInventory`
- 初回のみ `appConfig/settings` の `isAllOpen: false` と `collectionEpoch: 1`
- QR文字列・PNG一覧 `admin-output/qr-codes.xlsx`
- 印刷・配布用PNG `admin-output/qr-images/`

出力されたQR画像は、メンターへランダムに1枚ずつ配布できます。PNGは `qr-001.png` のような配布番号で出力され、特定のメンターを意味しません。実際のQR文字列にはランダムな `qrId` が入り、メンターが初回登録で名前を選んでQRを読むまで、誰にも紐付いていません。再取込時は既存の未割当QRを再利用し、メンター人数よりQR数が不足したときだけ追加発行します。

## 3. 公開（初回のみ・ローカルテスト不要）

1. GitHubにリポジトリを作成し、全ファイルを `main` ブランチへpushします。
2. **Settings > Pages** で Source を **GitHub Actions** にします。
3. **Settings > Secrets and variables > Actions > Variables** に、次のFirebase設定値を登録します。

   ```text
   VITE_FIREBASE_API_KEY
   VITE_FIREBASE_AUTH_DOMAIN
   VITE_FIREBASE_PROJECT_ID
   VITE_FIREBASE_STORAGE_BUCKET
   VITE_FIREBASE_MESSAGING_SENDER_ID
   VITE_FIREBASE_APP_ID
   ```

4. 同じ画面の **Secrets** に、前節で作った `FIREBASE_SERVICE_ACCOUNT_JSON` を登録します。
5. `main` へpushすると `.github/workflows/deploy.yml` が、GitHub上で本番ビルド、GitHub Pages公開、Firestoreルール反映を行います。ローカルで `pnpm dev` や `pnpm run build` を行う必要はありません。
6. GitHubの **Actions** で `Deploy to GitHub Pages` が成功したことを確認し、公開ドメインをFirebase AuthenticationのAuthorized domainsへ追加します。

`VITE_` で始まる値はブラウザへ含まれるFirebaseの公開設定です。秘密鍵ではありません。書込み安全性はFirestoreルールと、管理者だけが持つサービスアカウントJSONで守ります。

## 4. イベント運用

### 顔アイコン・プロフィール画像を更新する

Excelの対象行を更新してから、同じ取込コマンドを実行します。

- `iconUrl`：収集一覧に常時表示する顔アイコン。正方形の顔写真を推奨
- `imageUrl`：獲得時にモーダル表示するプロフィール帳の画像

```bash
pnpm admin:bootstrap -- --input ./data/mentors.xlsx --apply
```

`mentorId` は変更しないでください。既存のQR紐付けや獲得履歴を残したまま、画像だけを更新できます。

### 1名の誤登録を解除する

メンターのQR初回登録をやり直す場合は、次を実行します。

```bash
pnpm admin:bootstrap -- --unassign syokora --apply
```

QR対応表と、そのとき登録した端末の初期設定を解除します。その後、メンター本人が同じQRをもう一度登録できます。

### 1名だけ誤紐付けした場合（Firestore Consoleでの手動解除）

まずは上の `--unassign` を使う方法が安全です。Consoleで直接直す場合は、誤紐付けの `mentorQrBindings/{mentorId}` を開いて、次の2つの値を控えます。

- `qrId`
- `registeredByUid`

続けて、次の**3ドキュメントだけ**を削除します。

1. `mentorQrBindings/{mentorId}` — 誤紐付けされたメンターIDのドキュメント
2. `qrCodes/{qrId}` — 先ほど控えたQR IDのドキュメント
3. `deviceSetups/{registeredByUid}` — 先ほど控えた匿名認証UIDのドキュメント

`mentors/{mentorId}` と `qrInventory/{qrId}` は削除しないでください。前者を消すとプロフィールが一覧から消え、後者を消すと同じ物理QRを再登録できなくなります。3件を削除した後、該当メンターが初回画面で自分の名前を選び、同じQRをもう一度読み取れば再登録できます。

### 本番前に全紐付けをリセットする

動作確認で作成したQR紐付け、端末の「このスマホを使う人」設定、各ブラウザの獲得履歴をまとめてリセットします。実行前に、必ず対象Firebaseプロジェクトとサービスアカウントを確認してください。

```bash
pnpm admin:bootstrap -- --reset-event --apply --confirm RESET_EVENT
```

このコマンドは `qrCodes`、`mentorQrBindings`、`deviceSetups` の全ドキュメントを削除し、`isAllOpen` を `false` に戻します。`mentors`、`qrInventory`、物理QRは削除しないため、そのまま本番に使えます。

同時に `collectionEpoch` を1つ進めます。参加者がページを再読み込みすると、それまでのLocalStorageの獲得履歴は自動的に無効化され、空のコレクションから始まります。Firebase Authenticationの匿名UID自体は消しませんが、`deviceSetups` を削除するため同じ端末でも初期設定をやり直せます。

### イベント終了後に全開放する

Firebaseコンソールの `appConfig/settings` で `isAllOpen` をbooleanの `true` に変更します。参加者が再読み込みすると、獲得履歴に関係なく全プロフィールがカラー表示され、タップ可能になります。

## 注意事項

- 獲得履歴は端末・ブラウザごとのLocalStorageです。ブラウザのサイトデータを消すと履歴も消えます。管理コマンドの全リセット後は、ページを再読み込みすると以前の履歴を使わなくなります。
- QR登録済みのメンターQRを、URLや画面だけで厳密に本人確認する仕組みではありません。物理QRの配布・保管で運用してください。
- QRは初回登録が完了すると使用済みになります。使用済みQRを別のメンターへ渡さないでください。
- `iconUrl` と `imageUrl` は参加者のブラウザへ配信されるため、公開して問題ない画像だけを使ってください。

## 主なファイル

- [src/App.tsx](./src/App.tsx): 初回設定、QR登録、QR収集、進捗表示
- [src/hooks/useQrScanner.ts](./src/hooks/useQrScanner.ts): iPhone対応のカメラQR読み取り
- [src/lib/setup.ts](./src/lib/setup.ts): QR・メンター・端末のFirestore紐付け
- [firestore.rules](./firestore.rules): 参加者用のFirestore Security Rules
- [scripts/bootstrap-event.mjs](./scripts/bootstrap-event.mjs): Excel取込、QR在庫作成、QR画像出力、個別解除、全リセット
