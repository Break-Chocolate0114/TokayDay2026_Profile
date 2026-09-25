# 東海の日 QRプロフィール帳

東海の日のメンター交流で使う、QRコード式のプロフィール収集Webアプリです。既存のNFCカードとプロフィールURLには変更を加えず、会場の**入場QR**とメンター用のイベントQRを使います。iPhone / Android の Safari・Chrome に対応しています。

## 構成

| 役割 | 技術 | 用途 |
| --- | --- | --- |
| 画面・QR読取り | React + Vite + カメラAPI | 参加者がアプリ内のカメラでQRを読む |
| 公開 | GitHub Pages | HTTPS付きの静的サイトとして無料公開 |
| メンターデータ・QR紐付け | Firebase Firestore | 一覧、QR在庫、初回登録を管理 |
| 端末識別 | Firebase Authentication（匿名認証） | ログインなしで端末ごとのUIDを作る |
| メンター画像 | Cloudinary | 一覧アイコンと獲得時のプロフィール画像を配信 |
| 獲得履歴 | LocalStorage | 参加者の端末だけに保存 |
| 一括管理 | Node.js管理コマンド + Excel | Excel、画像フォルダ、QR在庫を一括反映 |

CloudinaryのAPI SecretとFirebaseサービスアカウントJSONは、**画像を反映する管理者PCだけ**で使います。公開サイト・GitHub Actions・Gitには置きません。

## イベントでの流れ

### 会場への入場

1. 参加者は、会場に掲示した入場QRをスマホ標準カメラで読む。
2. サイトが開き、匿名認証のUIDにだけ「入場済み」の印が保存される。
3. 続いて、初回設定で自分の名前または `その他` を選ぶ。

入場QRはURLの**フラグメント**（`#eventAccess=...`）に32バイトのランダムコードを含みます。コード自体はFirestoreに保存せず、SHA-256ハッシュだけを保存します。コードを知らないブラウザは、メンター一覧・画像URL・QR紐付け情報を取得できません。

### メンター本人のQR初回登録

1. メンター本人がプロフィール帳を初めて開く。
2. 自分の名前を選ぶ。
3. 手元にランダム配布されたイベントQRをカメラで読む。
4. Firestoreに「このQRは、このメンターのもの」という関係が一度だけ作られる。本人の顔アイコンはすぐ獲得済みになるが、画像ポップアップは開かない。

`その他` を選ぶと、QRの所有者登録をせず、収集機能だけを使う端末として初期設定します。

### 参加者の収集

1. `QRを読み取る` を押し、カメラを許可する。
2. メンターのイベントQRを読む。
3. Cloudinaryにあるプロフィール画像が表示され、獲得済みとして端末に保存される。一覧では顔アイコンがカラー表示になる。

既存NFCカードのURL、既存プロフィールサイト、Chrome履歴にはアクセスしません。

## Firestoreの構造

```text
mentors/{mentorId}                 # 管理コマンドがExcelとCloudinary URLから作成
  name
  generation
  iconUrl                           # 一覧に表示する正方形の顔アイコン
  imageUrl                          # 獲得時に大きく表示するプロフィール画像
  isOpenFromStart                   # true の人はQR未獲得でも開始時から閲覧可能
  active: true                      # Mentors タブに載る今回のイベント対象者

qrInventory/{qrId}                 # 管理コマンドが事前発行。ブラウザから読めない
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
  mentorId?                         # mentor の場合だけ
  qrId?                             # mentor の場合だけ
  createdAt

appConfig/settings
  isAllOpen: false
  collectionEpoch: 1                # 獲得履歴を一括リセットする世代番号

eventAccessCodes/{sha256(code)}     # 入場QRの生コードは保存しない
  active: true
  createdAt

eventAccessGrants/{anonymousAuthUid} # 入場済み端末にだけ作成
  codeHash
  grantedAt
```

FirestoreはConsoleで1件ずつ定義する必要はありません。管理コマンドが `mentors`、`qrInventory`、`appConfig/settings`、`eventAccessCodes` を作成し、残りのコレクションは会場入場・メンター本人の初回登録で自動作成します。

## 公開前の設定チェックリスト

このリポジトリからFirebaseやCloudinaryの実アカウント設定値は確認できません。次の項目を設定済みにしてください。**今回新たに必要になったのはCloudinaryの4項目です。**

### Firebase / GitHub

- [ ] FirebaseでWebアプリとFirestore Databaseを作成した（推奨ロケーション: `asia-northeast1`）
- [ ] Firebase Authenticationで「匿名」を有効にした
- [ ] GitHub Pagesの公開ドメイン（`GitHubユーザー名.github.io`）をAuthenticationのAuthorized domainsへ追加した
- [ ] GitHub Actions Variablesに6つの `VITE_FIREBASE_*` を登録した
- [ ] GitHub Actions Secret `FIREBASE_SERVICE_ACCOUNT_JSON` を登録した
- [ ] そのデプロイ用サービスアカウントに **Firebase Rules Admin** と **Service Usage Viewer** を付与した
- [ ] GitHub PagesのSourceを **GitHub Actions** にした

`Service Usage Viewer` がない場合、`serviceusage.googleapis.com ... Permission denied to get service [firestore.googleapis.com]` の403になります。

### Cloudinary（今回追加）

- [ ] Cloudinaryアカウントを作成した
- [ ] Cloudinary Consoleの **Settings > API Keys** で `Cloud name`、`API Key`、`API Secret` を確認した
- [ ] 管理者PCのリポジトリ直下にだけ `.env` を作り、3つの値を設定した
- [ ] メンター画像を `data/Images/` に置いた（このフォルダはGitへ追加されない）
- [ ] GitHub Pages公開後のサイトURLを控えた（会場入場QRの発行に使う）

`.env.example` は値を書かない設定見本です。初回だけ手元へコピーし、実値は `.env` に入力します。

```powershell
Copy-Item .env.example .env
```

```dotenv
CLOUDINARY_CLOUD_NAME=ここにCloud_name
CLOUDINARY_API_KEY=ここにAPI_Key
CLOUDINARY_API_SECRET=ここにAPI_Secret
CLOUDINARY_FOLDER=tokai-profile-book
```

`CLOUDINARY_FOLDER` は任意です。未指定でも `tokai-profile-book` を使います。署名付きアップロードを管理コマンドから行うため、CloudinaryのUpload Presetは不要です。画像のCloudinary公開IDはメンター名・IDを含まないランダム文字列で作られ、次回の画像更新時は同じランダムIDへ上書きされます。`API Secret` をGitHubのVariables / Secretsへ設定する必要はありませんし、設定してはいけません。

## 1. FirebaseとGitHubを初期設定する

1. [Firebaseコンソール](https://console.firebase.google.com/)でプロジェクトを作成し、Webアプリを登録する。
2. **Firestore Database** を作成する。ロケーションは `asia-northeast1`（東京）を推奨。
3. **Authentication > Sign-in method** で **匿名** を有効にする。
4. Google Cloudの **IAMと管理 > サービスアカウント** でルール反映専用のサービスアカウントを作り、次のロールを付与する。

   - **Firebase Rules Admin**（`roles/firebaserules.admin`）
   - **Service Usage Viewer**（`roles/serviceusage.serviceUsageViewer`）

5. JSON鍵を作り、内容をGitHubの **Settings > Secrets and variables > Actions > Secrets** に `FIREBASE_SERVICE_ACCOUNT_JSON` として登録する。
6. 同じ画面の **Variables** にFirebaseコンソールのWeb設定から次を登録する。

   ```text
   VITE_FIREBASE_API_KEY
   VITE_FIREBASE_AUTH_DOMAIN
   VITE_FIREBASE_PROJECT_ID
   VITE_FIREBASE_STORAGE_BUCKET
   VITE_FIREBASE_MESSAGING_SENDER_ID
   VITE_FIREBASE_APP_ID
   ```

7. GitHubの **Settings > Pages** でSourceを **GitHub Actions** にする。
8. `main` ブランチにpushする。Actionsの `Deploy to GitHub Pages` がサイト公開とFirestoreルール反映を行う。
9. 公開URLを確認後、Firebase Authenticationの **Settings > Authorized domains** に `GitHubユーザー名.github.io` を追加する。
10. [会場入場QRを発行する](#会場入場qrを発行する) を実行する。

`VITE_` で始まるFirebase値はブラウザに含まれる公開設定です。サービスアカウントJSON、Cloudinary API Secret、`.env` は公開しません。`.gitignore` で除外済みです。

## 2. メンターExcelと画像を準備する

テンプレート [data/mentors.template.xlsx](./data/mentors.template.xlsx) をコピーして、イベント用の `data/mentors.xlsx` を作ります。

| 列 | 必須 | 内容 |
| --- | --- | --- |
| `mentorId` | はい | 半角英数字・ハイフン・アンダースコア。以後変更しないID |
| `name` | はい | 表示名。画像ファイル名にもこの名前を含める |
| `generation` | はい | 例: `OB・OG`、`18期` |
| `isOpenFromStart` | いいえ | 当日不参加など、開始時から閲覧可能にする人だけ `true`（空欄・`false` は通常どおりQR獲得後に公開） |

データ行は見出し直後から連続して入力します。最初の空行より下は説明欄として扱われ、登録されません。

### アンケートと画像から対象メンターを作る

毎回 `Mentors` タブを手入力する必要はありません。既存の次の情報から、アプリ反映用の `Mentors` タブを自動生成できます。

- `Mentors_All`：`mentorId`、表示名、期の基礎名簿
- `参加アンケート回答者`：回答が「参加」「調整中」「遅刻」「早退」を含む人。ただし「不参加」「参加できません」「欠席」は除外
- `data/Images/`：ファイル名に表示名を含む人。アンケート上は不参加・未回答でも、顔写真を用意済みなら対象へ入れる

画像だけで対象になった人は、当日に読んでもらうQRがない前提で `isOpenFromStart: true` を自動設定します。アンケート対象の人は `false` です。ひらがな・カタカナの表記ゆれ（例: `かーき` / `カーキ`）は同じ名前として照合します。

通常はこのチャットで「アンケートと画像からメンター一覧を更新して」と依頼すれば、この生成・確認・次の画像反映まで実行します。管理者が手動で実行する場合の内部コマンドは次のとおりです。

```bash
# Mentorsタブの更新内容だけ確認する（Excelも外部サービスも変更しない）
pnpm admin:bootstrap -- --generate-mentors --input ./data/mentors.xlsx --dry-run

# Mentorsタブを更新する（Cloudinary・Firestore・QRは変更しない）
pnpm admin:bootstrap -- --generate-mentors --input ./data/mentors.xlsx --apply
```

生成後は `admin-output/mentor-selection-report.json` に、アンケート＋画像・アンケートのみ・画像のみの人数と選定結果が残ります。その後に通常の画像・Firestore反映を行います。

### 画像の置き方

`data/Images/` を作り、用途ごとのフォルダへ画像を置きます。サブフォルダも検索対象です。対応する拡張子は `jpg`、`jpeg`、`png`、`webp`、`gif`、`avif` です。

取り込み対象は `mentors.xlsx` の **`Mentors` タブ**です。存在しない場合だけ先頭タブを使います。普段は、このチャットで「メンター一覧と画像を反映して」と指示すればよく、管理画面で1名ずつ入力する必要はありません。反映された行には `active: true` が付き、Firestore内に残っている過去のメンターは削除せず一覧・初回登録候補から除外されます。

```text
data/
  mentors.xlsx
  Images/
    profile/
      ショコラ.png            # 大きなプロフィール表示と一覧アイコンの共通元画像
```

- 新規運用では `profile` / `プロフィール` フォルダへプロフィール画像を1枚だけ置く。大きく表示する `imageUrl` と、**上中央を正方形に切り抜く**一覧用 `iconUrl` をCloudinaryの変換URLで自動作成・登録する。元画像やアイコン用の複製ファイルは増えない。
- `icon` / `avatar` / `アイコン` フォルダの画像は、プロフィール画像がない旧データだけの互換用として扱う。プロフィール画像がある場合は、そちらから自動生成したアイコンを優先する。
- フォルダで区別するため、ファイル名へ `_icon` や `_profile` を付ける必要はない。ファイル名には対応するメンターの表示名を、`_`・半角スペース・ハイフンで区切られた独立した要素として含める（例: `18_現役_むむむ - 橋本莉穂.png`）。別メンター名の一部に偶然含まれる誤一致を防ぐため。
- 同じメンター・同じ種別の画像が複数ある場合、または1枚の画像が複数のメンター名に一致する場合は、誤登録防止のためコマンドを止める。
- Excelにいない名前を含む画像は**警告して今回の反映から除外**する。複数画像の誤一致だけは安全のためエラーにする。

画像がまだないメンターの行もExcelには登録できます。画像が未設定の人は一覧でシルエット表示になり、獲得後のモーダルでは「画像は準備中」と表示されます。再反映時に画像フォルダへ該当画像がなければ、Firestoreにある既存のURLを維持します。画像を更新しないときはフォルダを空にしても構いません。

当日参加できないメンターは、該当行の `isOpenFromStart` を `true` にしてください。QRを読まなくても一覧がカラーになり、プロフィールをタップして表示できます。値は `true` / `false` のほか、`はい` / `いいえ` でも入力できます。

### 管理者PCのサービスアカウントを用意する

Firebaseコンソールの **プロジェクトの設定 > サービスアカウント > 新しい秘密鍵の生成** でJSONをダウンロードし、プロジェクト外の安全な場所へ保存します。Node.js 20以上とpnpmを入れ、リポジトリ直下で一度だけ次を実行します。

```bash
pnpm install
```

PowerShellでは、画像・Excelを反映する作業中のターミナルだけにJSONの場所を設定します。

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\安全な場所\firebase-service-account.json"
```

このJSONは管理者権限を持つため、GitHub・Google Driveの共有フォルダ・リポジトリへ保存しないでください。アプリをローカル起動して確認する必要はありません。

## 3. Excel、画像、QRを一括反映する

アンケートや画像を更新した場合は、先に [アンケートと画像から対象メンターを作る](#アンケートと画像から対象メンターを作る) で `Mentors` タブを再生成してから、以下の反映を実行します。このチャットに依頼する場合は2段階をまとめて実行できます。

### 反映前に確認する

```bash
pnpm admin:bootstrap -- --input ./data/mentors.xlsx --dry-run
```

Excelの必須項目・ID形式・重複と、画像ファイル名の対応を検証します。Cloudinary、Firestore、QRファイルは変更しません。画像が未配置のメンターにFirestore上の既存URLがあるかどうかは、`--dry-run` では確認しません。

画像フォルダを別の場所にする場合だけ、次のように指定します。

```bash
pnpm admin:bootstrap -- --input ./data/mentors.xlsx --dry-run --images-dir "D:\event-images"
```

### 本反映する

```bash
pnpm admin:bootstrap -- --input ./data/mentors.xlsx --apply
```

1回のコマンドで次を行います。

1. `data/Images/` を再帰的に走査し、フォルダ種別とファイル名からメンターを判定する。
2. 対応するプロフィール画像をCloudinaryへ署名付きアップロードする。Cloudinary内では `tokai-profile-book/profiles/{ランダム文字列}` に格納され、氏名・mentorIdは公開IDに含まれない。上中央を切り抜いた正方形アイコンは同じ元画像から配信時に作られ、再反映は同じランダムIDを上書きする。
3. CloudinaryのHTTPS URL、公開ID、`isOpenFromStart` を `mentors` へ保存する。
4. `qrInventory`、初回の `appConfig/settings` を作成・更新する。
5. `admin-output/qr-codes.xlsx` と `admin-output/qr-images/` を出力する。
6. `admin-output/image-upload-report.json` に、反映に使った画像ファイルとURLの一覧を出力する。

QR画像は `qr-001.png` のような配布番号で出力され、特定のメンターを意味しません。任意のQRをランダムに1枚ずつ配布できます。メンターが初回登録で自分の名前を選びQRを読むまで、誰にも紐付いていません。

### 会場入場QRを発行する

**GitHub Pagesの公開後**に、一度だけ会場用の入場QRを発行します。URLに秘密のようなコードを載せるため、ターミナル出力や共有メモへURLをコピーせず、生成されるPNGだけを会場で掲示してください。

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\安全な場所\firebase-service-account.json"
pnpm admin:bootstrap -- --issue-entry-qr --event-url "https://GitHubユーザー名.github.io/リポジトリ名/" --copies 3 --apply
```

`admin-output/entry-qr/event-entry-qr-01.png`〜`03.png` が会場掲示用です。3枚は同じ入場コードを含む複製なので、別の場所に掲示できます。同じ入場URLは `admin-output/entry-qr/event-entry-url.txt` にも保存されます。URLには入場コードが含まれるため、主催者だけが保管し、メール・チャット・GitHubには貼り付けないでください。`EVENT_ACCESS_URL` を `.env` に設定済みなら、`--event-url` は省略できます。発行前のURL形式だけを確認する場合は `--dry-run` を使います。

```bash
pnpm admin:bootstrap -- --issue-entry-qr --event-url "https://GitHubユーザー名.github.io/リポジトリ名/" --copies 3 --dry-run
```

入場QRは特定の参加者用ではありません。会場にいる人が標準カメラで一度読むための共通QRです。参加者の端末では、コードをアドレスバーから取り除いた後に利用します。

## 4. イベント運用

### 管理操作クイック一覧

ここでは、このチャットへ依頼できる操作と、管理者PCで同じことを実行するコマンドをまとめます。Firestoreを変更する操作には、事前に `GOOGLE_APPLICATION_CREDENTIALS` の設定が必要です。

| やりたいこと | このチャットへの依頼例 | 管理者PCのコマンド | 変更範囲 |
| --- | --- | --- | --- |
| アンケート・画像から対象者一覧を作る | 「アンケートと画像からメンター一覧を更新して」 | `pnpm admin:bootstrap -- --generate-mentors --input ./data/mentors.xlsx --apply` | Excelの `Mentors` タブだけ |
| 一覧・画像をCloudinary/Firestoreへ反映 | 「メンター一覧と画像を反映して」 | `pnpm admin:bootstrap -- --input ./data/mentors.xlsx --apply` | 画像、現行メンター、QR在庫 |
| プロフィール画像を更新 | 「○○のプロフィール画像を更新して反映して」 | 上と同じ | 同じ画像の上中央アイコンも更新 |
| 全員公開をON | 「全員公開モードにして」 | `pnpm admin:bootstrap -- --set-all-open true --apply` | `isAllOpen` のみ |
| 全員公開をOFF | 「全員公開モードを解除して」 | `pnpm admin:bootstrap -- --set-all-open false --apply` | `isAllOpen` のみ |
| 1名のQR紐付けを解除 | 「syokoraのQR紐付けを解除して」 | `pnpm admin:bootstrap -- --unassign syokora --apply` | その人のQR・端末紐付けのみ |
| 本番前に全QR紐付けをリセット | 「本番前の全リセットを実行して」 | `pnpm admin:bootstrap -- --reset-event --apply --confirm RESET_EVENT` | 全メンターQR紐付け・端末設定・入場権を削除 |
| 会場入場QRを3枚発行 | 「会場入場QRを3枚発行して」 | `pnpm admin:bootstrap -- --issue-entry-qr --event-url "https://GitHubユーザー名.github.io/リポジトリ名/" --copies 3 --apply` | 入場コード、QR PNG、URLテキスト |

通常は管理コマンドを手元で実行せず、目的をこのチャットへ伝えるだけで大丈夫です。全リセットだけは元に戻せないため、実行前に対象を確認します。

### プロフィール画像・顔アイコンを更新する

1. `data/Images/profile/` の該当画像を新しいファイルに差し替える。
2. ファイル名には対応するメンターの表示名を含める（例: `ショコラ.jpg`）。ファイル名の接尾辞は不要。
3. 同じ反映コマンドを実行する。

```bash
pnpm admin:bootstrap -- --input ./data/mentors.xlsx --apply
```

`mentorId` は変更しないでください。既存のQR紐付けと獲得履歴を残したまま、画像だけを更新できます。Cloudinaryはプロフィール画像の**上中央**を256×256の正方形アイコンとして配信します。画像ファイルを置かずに反映すると、既存画像URLを維持します。

### 当日不参加のメンターを最初から公開・非公開にする

Excelの `isOpenFromStart` を変更して、同じ反映コマンドを実行します。

- `true`（または `はい`）: QR未獲得でも最初からカラー表示され、プロフィールを開ける
- 空欄・`false`（または `いいえ`）: 通常どおり、QR獲得後だけ開ける

この設定はメンターごとの公開状態で、イベント終了後の全員公開 `appConfig/settings.isAllOpen` とは別です。全員公開が `true` の間は、各行を `false` にしても全員閲覧可能です。

### 1名の誤登録を解除する

```bash
pnpm admin:bootstrap -- --unassign syokora --apply
```

QR対応表と、そのとき登録した端末の初期設定を解除します。その後、メンター本人が同じQRをもう一度登録できます。

### 1名だけ誤紐付けした場合（Firestore Consoleでの手動解除）

まずは上の `--unassign` を使う方法が安全です。Consoleで直接直す場合は、`mentorQrBindings/{mentorId}` を開き、`qrId` と `registeredByUid` を控えます。次の**3ドキュメントだけ**を削除します。

1. `mentorQrBindings/{mentorId}`
2. `qrCodes/{qrId}`
3. `deviceSetups/{registeredByUid}`

`mentors/{mentorId}` と `qrInventory/{qrId}` は削除しません。削除後、該当メンターが同じQRを再登録できます。

### 本番前に全紐付けをリセットする

```bash
pnpm admin:bootstrap -- --reset-event --apply --confirm RESET_EVENT
```

このコマンドは `qrCodes`、`mentorQrBindings`、`deviceSetups`、`eventAccessCodes`、`eventAccessGrants` を全削除し、`isAllOpen` を `false` に戻します。`mentors`、`qrInventory`、Cloudinaryの画像、物理QRは削除しません。同時に `collectionEpoch` を進めるため、参加者が再読み込みすると以前のLocalStorage獲得履歴を使わなくなります。

全リセット後は、上の「会場入場QRを発行する」を再実行して、新しい会場QRを掲示してください。旧QRは無効になります。

### イベント終了後に全開放する

```bash
pnpm admin:bootstrap -- --set-all-open true --apply
```

参加者が再読み込みすると、獲得履歴に関係なく全プロフィールがカラー表示され、タップ可能になります。通常表示へ戻す場合は次を実行します。

```bash
pnpm admin:bootstrap -- --set-all-open false --apply
```

## 注意事項

- Firestoreは、会場入場QRを読み取って匿名UIDへ入場権を作るまで、メンター一覧・設定・QR紐付けを読めません。QRの画像やURLを会場外へ共有しない運用にしてください。これは会場参加の導線を作る簡易なアクセス制御であり、厳格な個人認証ではありません。
- Cloudinaryの配信URLは参加者ブラウザへ渡るため、URLを知る人は画像を表示できます。Media Libraryの一覧はCloudinaryアカウント所有者だけが見られますが、公開して問題ない画像だけを使ってください。ランダム公開IDはURLの推測を難しくする補助策で、アクセス制御そのものではありません。
- 獲得履歴は端末・ブラウザごとのLocalStorageです。ブラウザのサイトデータを消すと履歴も消えます。
- QRの本人確認は物理QRの配布・保管で行う運用です。QR登録済みのQRを別のメンターへ渡さないでください。
- `firestore.rules` はGitに含めて問題ありません。認証情報を含まず、参加者ブラウザに許可する操作を定義する公開ルールです。

## 主なファイル

- [src/App.tsx](./src/App.tsx): 初回設定、QR登録、QR収集、進捗表示
- [src/lib/eventAccess.ts](./src/lib/eventAccess.ts): 会場入場QRによる匿名UIDへの入場権登録
- [src/hooks/useQrScanner.ts](./src/hooks/useQrScanner.ts): iPhone対応のカメラQR読み取り
- [src/lib/setup.ts](./src/lib/setup.ts): QR・メンター・端末のFirestore紐付け
- [firestore.rules](./firestore.rules): 参加者用のFirestore Security Rules
- [scripts/bootstrap-event.mjs](./scripts/bootstrap-event.mjs): Excel取込、Cloudinaryアップロード、メンターQR在庫・会場入場QRの発行、個別解除、全リセット
