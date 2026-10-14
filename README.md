# ゲームハブ

unityroom に上げてもらったゲームを、サムネイルとタイトルの一覧から選んで遊べるページです。

- 一覧でカードを押すと、サムネイル・タイトル・操作方法・説明が出ます。「遊ぶ」を押すと、unityroom のページが新しいタブで開きます
- 右下の「編集」からパスワードを入れると、ゲームの追加・編集・削除・並べ替えができます
- データは Firebase（Firestore）に保存されるので、どの PC から開いても同じ一覧が出ます

## ファイル

| ファイル | 中身 |
| --- | --- |
| `index.html` / `style.css` / `app.js` | ページ本体 |
| `store.js` | Firebase とのやりとり（未設定のときはデモモード） |
| `firebase-config.js` | Firebase の設定・管理者のメールアドレス・ハブの名前 |
| `firestore.rules` | Firestore のルール（コンソールに貼る） |

## 1. Firebase を準備する（最初の1回だけ）

1. https://console.firebase.google.com/ を開き、「プロジェクトを作成」。名前は何でもよい（Google アナリティクスはオフでよい）
2. **Web アプリを登録**：プロジェクトのトップで `</>`（ウェブ）を押し、名前を付けて登録（Hosting のチェックは不要）。表示された `firebaseConfig` の値を `firebase-config.js` に貼る
3. **ログインの準備**：左のメニュー「構築 → Authentication」→「始める」→「メール / パスワード」を有効にする
4. **管理者アカウントを作る**：Authentication の「ユーザー」タブ →「ユーザーを追加」で、メールアドレスとパスワードを入れる
   - このメールアドレスを `firebase-config.js` の `adminEmail` に入れる
   - パスワードが、編集画面で入れるパスワードになる
5. **データベースを作る**：「構築 → Firestore Database」→「データベースを作成」→ 本番環境モードで作成（場所は `asia-northeast1`（東京）がおすすめ）
6. **ルールを貼る**：Firestore の「ルール」タブに `firestore.rules` の中身を貼り、メールアドレスを手順4のものに置き換えて「公開」
7. （おすすめ）Authentication の「設定 → ユーザーアクション」で「作成（登録）を有効にする」をオフにする。ほかの人がアカウントを作れなくなる

`firebase-config.js` の値は、公開されても大丈夫なものです。書き換えられるのは、ルールで指定した管理者アカウントだけです。

## 2. 手元で試す

Python が入っていれば、このフォルダで次を実行して http://localhost:8765 を開く。

```bash
python -m http.server 8765
```

`firebase-config.js` が空のあいだ、または URL の最後に `?demo` を付けて開いたときはデモモードです。データはそのブラウザの中だけに保存され、編集パスワードは `demo` です。

## 3. 公開する（GitHub Pages）

1. GitHub で新しいリポジトリを作る（Public）
2. このフォルダを push する
3. リポジトリの「Settings → Pages」で、Source を「Deploy from a branch」、ブランチを `main` / `/ (root)` にして保存
4. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で開けるようになる

ゲームの追加や編集は公開したページからできるので、ファイルを直す必要はありません。

## 4. バックアップ

GitHub Actions（`.github/workflows/backup.yml`）が、3時間ごとに Firestore のゲーム一覧・サムネイル・動画を `backup` ブランチに保存します。

- 内容が変わったときだけ記録が増え、過去の記録はすべて残ります
- 2026/11/4（日本時間）を過ぎると、何もしなくなります。延ばすときは `backup.yml` の日付を変えます
- すぐに取りたいときは、GitHub の「Actions」→「バックアップ」→「Run workflow」

戻すときは、`backup` ブランチの戻したい時点の中身をフォルダに取り出して、次を実行します。

```bash
python tools/restore.py <取り出したフォルダ> --dry-run
```

何が変わるかを確かめたら、`--dry-run` を外してもう一度実行します（管理者のパスワードを聞かれます）。
