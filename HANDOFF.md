# 引き継ぎブリーフ — 文芸的プログラミング × Cloudflare OS Gadget

作成日: 2026-08-07 / 引き継ぎ先: Claude Code（ローカル実行環境）

このファイルは、別セッションで行った調査・実装の引き継ぎ資料です。
**検証済みの事実**と**未検証の推測**を明示的に分けてあります。
未検証の項目を既成事実として扱わないでください。

---

## 1. 何をしようとしているか

### 仮説

Cloudflare OS の **Blueprint を文芸的文書（literate program）にする**と、
TypeScript も JavaScript も読めない利用者が、
**散文を読んでエージェントに変更を依頼できる**ようになるのではないか。

### なぜ成立しそうか

Blueprint の配布モデルは「コードのコピーを配り、各自が自分の手元で改造する」であり、
**上流からの自動更新機構が存在しない**（公式ドキュメントに明記）。
したがって利用者は自分のコピーを理解して自分で直すしかない。

文芸的プログラミングが 40 年間欠いていたのは、まさにこの
「自分が書いていないコードを所有し、改造する非プログラマ」という読者層である。
Gadget モデルは初めてそれを大量に生む。

### tangle / weave の向きの逆転

原型（Knuth）では人間が原文を書き、機械が両方の出力を作った。
ここでは **エージェントが原文を書き、人間が weave 出力を読む**。
散文が一次でコードが二次、という関係が原型より徹底する。

### 主要な未解決問題

**散文が信用できるか。** エージェントが書いた説明は流暢だが誤りうる。
散文を主にするということは、嘘の置き場所が増えるということでもある。
対策の方向性として `witness`（後述 §6）を検討中。

---

## 2. 検証済みの事実

以下はすべて実際にコマンドを実行して確認済み。

### 2.1 文芸的プログラミングの道具立て

| 事実 | 確認方法 |
|---|---|
| noweb 風 tangler は Perl 40 行で足りる | `ntangle` を書いて動作確認 |
| チャンク参照のインデント引き継ぎが実装の要 | 入れ子ループで確認 |
| 循環参照検出も数行 | `a -> b -> a` で発火を確認 |
| **CWEB は `#line` 指令を出力する** | `ctangle sieve.w` の出力を目視 |

最後の項目が重要。**source map 問題は Knuth が 1980 年代に解いていた**。
tangle 後もコンパイラのエラーは原文（`.w`）の行番号で報告される。
JavaScript 側は Source Map v3 を吐けば同じことができる（未実装）。

### 2.2 Blueprint の内部構造

同梱の `packages/workshop-backend/format-blueprints/workspace-docs.gadget`
をバイナリから解いて確認した。

**`.gadget` コンテナ形式**（ビッグエンディアン）:

```
 0..7   マジック  0xec2e2d3a2300e317
 8..11  形式版    1
12..15  メタ長    (uint32)
16..23  本体長    (uint64)
        JSON メタデータ
        gzip 圧縮された Yjs V2 スナップショット
```

**中身の構造**: ルートキーが空文字列 `""` の `Y.Map`。
**キーがファイル名、値が `Y.Text`**。ディレクトリ構造はない。

`workspace-docs`（Cloudflare 純正のドキュメントエディタ）の全ファイル:

| ファイル | サイズ |
|---|---|
| `client.js` | 70,113 |
| `server.js` | 10,649 |
| `README.md` | 5,879 |

**3 ファイルのみ。`package.json` もビルド設定もない。**

さらに重要な点として、**TypeScript ではなく素の JavaScript**。
`client.js` は React ではなく素の DOM 操作。
つまり **Gadget を書くのに TypeScript の知識は不要**。
TS が要るのは Workshop 本体（TSX / Vite / TanStack Router）のみ。

コメント率: `server.js` 298 行中 21 行（7.0%）、`client.js` 1748 行中 99 行（5.7%）。

### 2.3 Gadget の API

`packages/workshop-backend/src/agent.ts` 内、エージェントへの指示文から確認。

- `server.js` は Durable Object。クラスは必ず `Gadget` の名で export
- `fetch` ハンドラは不要。プラットフォームがルーティングする
- 状態は `this.ctx.storage`（KV / SQLite）。**メモリに置いてはいけない**
- `client.js` はサンドボックス iframe 内。`index.html` は存在せず、DOM を全部 JS で組む
- グローバル変数 `gadget` がサーバへの RPC スタブ（Cap'n Web）
- `RpcTarget` は client.js では import 不要（既に入っている）。server.js では `cloudflare:workers` から
- **関数を RPC で参照渡しできる**。購読には `.dup()` で長命スタブを取り、`onRpcBroken` で切断を検知する
- Gadget のコードは実行時にインターネットへ出られない。外界とは binding（`this.env`）経由のみ
- iframe サンドボックスのため `alert()` / `confirm()` は使えない

### 2.4 Gatekeeper の承認フロー

読むべきファイルは実質 2 つ。UI 側は合計 1100 行程度と薄い。

- `packages/workshop-shared/src/api.ts` — `ActionState`、`ActionRecord`、承認系 RPC
- `packages/workshop-shared/src/gatekeeper.ts` — `ActionKind`（`tag` と `label` の対）

確認できた設計:

- ログ項目は 3 種。**`observation`（読み取り）は記録のみで承認を経ない**。
  `action`（副作用あり）だけが承認対象。`bindHook` は enable/disable のみ
- `ActionState = "pending" | "approved" | "rejected"`
- **自動的な却下は存在しない**。却下は必ず人間の行為
- 自動承認は `actionKind.tag` を鍵にする。**`actionKind` は省略可能で、
  タグを持たない action はどのルールにも一致せず、永久に人手の承認を要求する**
  （**補足** — 永久に手動になる道はもう一つある。タグを持っていても
  `autoApprovable` が false なら同じく自動承認されない。実例は §2.14）
- `resolvedBy` に解決者が残る。自動承認の場合は**ルールを有効にした人**が記録される
- ~~ルールを後から追加すると、一致する pending の action がその場で適用される~~
  **訂正（2026-08-10、§2.14）**: 適用されるのは、**その action より前に
  人手を要する保留がない場合に限る**。ドレイナは id の昇順に見て、
  自動適用できないものに当たったらそこで止まり、飛び越えない
  （`auto-approval.ts:72-73` — `autoApprovable !== true || rule === undefined`）。実機で確認済み
- **シミュレーションはプラットフォーム機能ではなく、各 Gatekeeper の自前実装**。
  Google のものだけが本格的（`#simulationCache` を持つ）。
  「承認待ちでもエージェントが進める」の実現度は接続先ごとにばらつく

`gatekeeper.ts` のコメントに、将来のポリシーエンジン向け検討軸が残っている
（可逆か、自由記述を含むか、既存内容の書き換えか新規作成か、等）。
現状の tag 一本より細かい判断をしたいという意図。

### 2.5 試作した Gadget

`counter.nw` — 共有カウンタ。Cloudflare のコードは一切使わず新規に書いた。

```
ntangle -r server.js counter.nw > server.js   # 31 行
ntangle -r client.js counter.nw > client.js   # 26 行
```

両方 `node --check` を通過。**2026-08-07 に実機で動作を確認した**（§2.8）。

散文比率 43%。純正 `workspace-docs` の 7.0% と比べると、
これが「literate 化する」という言葉の実体。

### 2.6 ローカル実行（手順1）— 2026-08-07 に実行して確認

**`pnpm run-local` は動く。** `http://localhost:8787` が HTTP 200 を返し、
ログに `[wrangler:info] Ready on http://localhost:8787` が出る。
初回応答は 15 秒、暖機後は 11〜25ms。**LLM の API キーは起動自体には不要**だった
（キーが要るのはエージェントを使う段階と思われるが、そこは未確認）。

`reference/` の origin は上流ではなく**プライベートフォーク**
`https://github.com/tokuhira/cloudflare-os.git` に差し替えた。
差し替え時点でフォークの `main` は上流と同一コミット `0eaec6c` だったため、
再 clone せず `git remote set-url` だけで済ませている。

#### フォークのブランチ構成

| ブランチ | 役割 |
|---|---|
| `main` | 上流の素の写し。**触らない**。上流追従はここに当てる |
| `literate-gadget-minimal` | この実験用の最小構成。`setup.sh` が clone するのはこちら |

`literate-gadget-minimal` は `main` に**リネーム 15 件だけ**を載せたもの
（`15 files changed, 0 insertions(+), 0 deletions(-)`）。
何を変えたかは `git diff main..literate-gadget-minimal` で一覧できる。

リモートは 2 つ登録してある。`upstream` は**事故防止のため push URL を潰してある**
（規約 4）。

```sh
origin    https://github.com/tokuhira/cloudflare-os.git   (fetch/push)
upstream  https://github.com/cloudflare/cloudflare-os.git (fetch のみ)
```

clone は `--depth 1` の shallow である。当初「上流追従には `--unshallow` が
要る」と書いていたが、**実際にやってみると `--depth=50` で足りた**（§2.12）。
全履歴を落とす必要はない。

#### メモリ不足で落ちる問題と、その回避

**素で走らせると OOM killer に殺される。** 実際に落ちたうえ、
**Claude Code のプロセス自体も巻き添えで kill された**（`dmesg` に記録あり）。
このときの WSL2 の総メモリは 3.7Gi（ホスト 7.6 GiB の既定 50%、`.wslconfig` なし）。

原因は `run-dev-server.js` の作りにある。`packages/gatekeeper-*` を走査し、
**gatekeeper ごとに常駐 watcher を spawn する**（configurator UI と app UI）。
16 パッケージで watcher 15 個、実測 RSS は 1 個あたり約 110MB。

回避策として、各 `packages/gatekeeper-*/wrangler.jsonc` を
`wrangler.jsonc.disabled` にリネームした。`findGatekeepers` は
`gatekeeper-` で始まり `wrangler.jsonc` を持つものだけを拾うので、これで検出から外れる。
**ディレクトリ名も package 名も変えないため pnpm workspace とロックファイルは無傷**で、
戻すのもリネームし直すだけ。

```sh
# 特定の gatekeeper を戻す（手順2 で承認 UI を見るときはこれが要る）
mv packages/gatekeeper-github/wrangler.jsonc{.disabled,}
```

**この間引きはフォークの `literate-gadget-minimal` ブランチにコミット済み**なので、
`setup.sh` から clone し直せば最初から間引かれた状態で始まる。

`gatekeeper-context` **だけは残す**こと。core が Context アカウントを
自動プロビジョンする旨が `run-dev-server.js` のコメントにあり、外すと壊れる恐れがある
（実際に外して確かめてはいない）。

結果、watcher は 15 → 1、空きメモリ 1.4Gi で安定動作した。
（**その後 2 個になった。** 承認 UI の観察に `gatekeeper-mcp-portal` が要るので
有効化してある。§2.14）

**2026-08-16 追記。** 上流がビルドを Vite+ に載せ替えたため、
**UI のビルドはこの間引きを通らなくなった**。`vp run -r` はタスクを宣言している
パッケージを全部選ぶので、無効化した gatekeeper の UI も作られる。
間引きが効くのは Worker の起動側だけである（§2.24）。
なお**手順3 に gatekeeper は不要**である。要るのは手順2 の承認 UI 観察のときだけ。

もう一点。**クラッシュすると `run-dev-server.js` が孤児として生き残り、
watcher をぶら下げ続ける。** 実際に 2.4 時間ぶんの残骸が約 600MB を占めていた。
再実行の前に `ps -eo pid,etimes,args | grep cloudflare-os` で
経過時間の長いものを確認して kill すること。

### 2.7 エージェントを介さず Gadget を載せる道 — 2026-08-07

**LLM の API キーなしで Gadget を実機に載せられる見込みが立った。** 以下は
コードとドキュメントを読んで確認した事実と、実際に動かして確かめた事実の両方を含む。

#### API キーについて（確認済み）

- **セットアップウィザードはモデル未設定のまま完了する。** ブラウザで実際に通した。
  最終画面に "Bring your own models — Plug in personal API tokens from any provider"
  とあり、後付けできる設計。
- **Claude Pro / Max のサブスクリプションに API クレジットは含まれない。**
  claude.ai と Claude Code 用であり、API は別課金。Gadget が要求するのは素の API キー。
- `--use-workers-ai-binding` フラグは**この用途には使えない**。
  `docs/public-server.md` に「Inference itself no longer uses the binding; it goes
  over HTTPS with the tokens above」とあり、`WORKERS_AI` バインディングは現在
  webFetch の HTML→Markdown 変換専用。推論経路ではない。
  （**注意** — これは「バインディングは推論経路ではない」という話であって、
  **Workers AI が推論に使えないという意味ではない**。HTTPS 経由なら
  エージェントのモデルとして一級で使える。§2.19 で訂正した）
- キーを使う場合の設定先はリポジトリルートの `.dev.vars`（`KEY=VALUE`、gitignore 済み）。
  `run-dev-server.js` の `loadDevVars()` が起動時に読む。Cloudflare AI Gateway 経由の
  `CF_AI_GATEWAY*` という選択肢もある（**中身は §2.19 で調べた**）。

#### Blueprint インポートという迂回路（コードで確認）

UI に**エージェントを通さない経路**がある。

| 経路 | 場所 |
|---|---|
| `.gadget` のインポート | `BlueprintList.tsx:195` — `importBlueprint` |
| Blueprint から Gadget 生成 | `BlueprintLandingPage.tsx:567` — `newGadgetFromBlueprint` |
| 画面 | `routes/blueprints.tsx`、`routes/blueprint.$id.tsx` |

なお `Overseer.createGadget(title, chatId?, bindingName?)` は **`chatId` を省略すると
恒久的に作成される**（`api.ts:1655-1664` に "Without `chatId` the gadget is created permanently"）。`bindingName` 省略時の自動命名は
「via the quick model **when configured**, else a generic fallback」とあり、
**モデル不在が想定された設計**になっている。ただしフロントエンドの `createGadget`
参照は全て `ChatInterface.tsx`（エージェントのツール呼び出しの描画）で、
**ユーザが直接叩く UI は見当たらなかった**。だから Blueprint 経由を採る。

#### `.gadget` の書き出し仕様（シリアライザから取得）

§2.2 はバイナリを解いて得た読み取り仕様だったが、今回は**書き出し側の実装**から
確認した。出典は `blueprint-archive.ts` の `encodeBlueprintArchivePrefix()` と
`overseer.ts` の `initializeFromBlueprint()`。

- プレフィックス 24 バイト、**ビッグエンディアン**（`DataView` の既定）
- `content` は **gzip 圧縮した Yjs V2 更新**（`Y.encodeStateAsUpdateV2`）
- **`contentLength` は圧縮後のバイト数**。R2 にそのまま入れ、読み出し時に
  `DecompressionStream("gzip")` を通すため。`FixedLengthStream(contentLength)` で
  検証されるので食い違うと弾かれる
- doc は**無名ルート**の `Y.Map`（`doc.getMap()` を引数なしで呼ぶ）。キーがファイル名、
  値が `Y.Text`。`overseer.ts` に "the archive always uses the unnamed root" と明記
- メタデータの必須キーは `title, description, author, created, version, lastUpdated,
  bindings`。`output` は省略可（"Absent means a generic app"）。上限はメタ 64KiB、本体 32MiB

#### 作った道具と、その検証（実行して確認）

`tools/mkgadget.mjs` — `.gadget` を組み立てる Node スクリプト。`yjs` は
cloudflare-os 側の依存（`packages/workshop-backend/node_modules/yjs`）を借りるので、
このリポジトリの「必須は perl / make / git」は崩していない。

```sh
node tools/mkgadget.mjs -o gadgets/counter/counter.gadget \
    -t "Literate Counter" gadgets/counter/server.js gadgets/counter/client.js
```

検証は 2 段階で行った。

1. **往復検証** — 生成物を解き直し、`server.js` / `client.js` が tangle 出力と
   1 バイトも違わないことを確認した
2. **形式の裏付け** — **同じロジックで Cloudflare 純正の `workspace-docs.gadget` が
   解けた**。メタデータのキー構成が純正と完全に一致し、`bindings: {}` と `output` 省略も
   純正がそうなっていた。ファイルサイズ（`server.js` 10,649 / `client.js` 70,113 /
   `README.md` 5,879）も §2.2 の記録と一致し、そちらも再確認できた

### 2.8 手順3 完了 — `counter.nw` は実機で動く（2026-08-07）

**`counter.gadget` のインポートが通り、生成した Gadget が動作した。**
これで §2.5 の「tangle 出力が実機で動くか」が検証済みになった。

確認できたこと:

- **Blueprint インポートは API キーなしで通る。** モデル未設定のまま、
  `.gadget` のアップロード → Blueprint から Gadget 生成 → 実行、まで到達した。
  §2.7 で立てた「エージェントを迂回する」筋書きが実際に成立した
- **`counter.nw` の tangle 出力はそのまま動く。** ボタンでカウンタが増減する
- **リアルタイム同期が働く。** 通常ウィンドウとシークレットウィンドウ、
  つまり**別セッション間**で即座に連動した。タブ 2 つより強い条件で確認できている
- 自作した `.gadget` が本家に受理された。§2.7 の形式理解が実機で裏付けられた形

Gadget の画面には **App / Code / Connections** のタブがある。

### 2.9 `.nw` は 4 つ目のファイルとして置ける（2026-08-07）

**手順4 の前半が肯定で決着した。** `Code` タブから `counter.nw` を作成し、
177 行の中身を投入し、その状態で **App が正常に動作した**。

- **拡張子の制限はない。** `FileSidebar.tsx` の作成時検証は「空でない」「重複しない」
  の 2 つだけ。`.nw` はそのまま通る
- **エディタは `plaintext` にフォールバックする。** `getLanguage.ts` の `default` 節。
  色は付かないが編集できる。`.nw` は散文とコードの混在なので単一言語の色付けは
  そもそも不適切であり、妥当な落としどころ
- ~~**明示的な「保存」操作はない。** 編集が随時反映される（コードは Yjs の共有 doc なので
  当然ではある）~~
  **訂正（2026-08-12、§2.22）**: 既存ファイルの本文編集はそうだが、
  **新規ファイルの追加とエージェントによる編集は `Pending changes` を経る**。
  `Accept changes` を押すまで Gadget には反映されない
- **4 つ目のファイルがあっても App は壊れない。** ランタイムは `server.js` と
  `client.js` だけを見て、知らないファイルは無視するとみられる

これで「`.nw` を Gadget に同居させる」構想の土台ができた。

#### 副産物: `counter.nw` の client に欠陥が見つかった

ファイルを追加した際、**別セッション（シークレットウィンドウ）の連動が切れた**。
リロードで復旧した。

原因は `client.js` の再購読処理と考えられる（**機序は未確認**、§3 参照）。
コードを変更すると Gadget が再起動し、RPC 接続が切れる。`client.js` には
`[Symbol.dispose]()` で再購読する記述があるが、次の 3 点が足りない。

1. `subscribe()` の**戻り値を捨てている**。初回は現在値の表示に使っているのに
   再購読時は使っていないので、成功しても次のブロードキャストまで画面が古いまま
2. **失敗を扱っていない**。`gadget` スタブ自体が切れていれば `subscribe()` は
   失敗するが catch がなく、黙って死ぬ
3. `Symbol.dispose` が**接続断で発火する保証がない**。§2.3 に記録した API は
   「`onRpcBroken` で切断を検知する」であり、`Symbol.dispose` とは別の契機

**これはプラットフォームの不具合ではなく `counter.nw` の欠陥。** 修正は
§6.3（追記を差分の単位にする）を実測する好機でもある。

### 2.10 再接続の修正が効かなかった — §6.2 の実例（2026-08-07）

§2.9 の欠陥を直すつもりで `counter.nw` に「接続と再接続」の節を足し、
`try`/`catch` とリトライを書いた。**実機で試したところ、まったく効かなかった。**

観察: コードを編集すると、編集していない側のウィンドウは**数字が固まり、
ボタンも不動になる**。エラーメッセージも出ない。リロードで復旧する。

原因は `agent.ts:534` — `calls made while its replacement is being acquired will wait`
— つまりプラットフォームがエージェントに与えている説明にある。

> The top-level `gadget` stub survives backend reconnects, and calls made
> while its replacement is being acquired **will wait**.

**`gadget` への呼び出しは失敗時に例外を投げず、待ち続ける。** したがって
`await gadget.subscribe(...)` は解決せず、`catch` は一度も走らない。
書いたリトライ処理は**一度も実行されていなかった**。`try`/`catch` は
ハングに対して無力である。

さらに前提を取り違えていた。ドキュメントの言う "backend reconnects"（一時的な
再接続）と、コードの**再デプロイ**は別物である。前者なら `gadget` は待って
復帰するが、後者では待つ相手がもう存在しない。同ファイル 470 行に
"Clients may frequently reload" とあり、**プラットフォームはリロードを正常な
運用として想定している**。再デプロイからの自動復帰は想定外の可能性が高い。

#### なぜこれが §6.2 の実例なのか

- 散文は流暢で、もっともらしかった
- 散文は機序を誤っていた（「少し待ってから何度か試す」＝失敗が例外として
  現れるという前提）
- **散文が間違っていたから、コードも間違った。** しかも no-op という形で
- tangle も `node --check` も通った。**動かすまで分からなかった**

§6.2 は「散文を主にするということは、嘘の置き場所が増えるということでもある」
と書いていたが、実際に起きたのはそれより悪い。**誤った散文が誤ったコードを
生んだ。** 文書とコードが食い違ったのではなく、仲良く揃って間違っていた。
`witness`（§6.1）が要るという主張の、具体的な裏付けになる。

#### 決着: 自前の再接続は不要だった（2026-08-07 に修正済み）

当初はタイムアウトで作り直すつもりだったが、**プラットフォーム側が既に
同じことをやっていた**ことが分かり、`counter.nw` からは再接続処理を
**削除**した。いまの「接続と再接続」節は、なぜ自前で作らないかを説明している。

根拠（節に証拠として記載済み）:

- `GadgetUI.tsx:355-365` — iframe から見える `gadget` は**親フレーム側の Proxy**。
  再接続中の呼び出しは `pending.promise` を待つ。`agent.ts:534` の
  "will wait" の正体はこれ（推理）
- `GadgetUI.tsx:218-238` — プラットフォームは `Promise.race` で **5 秒**待ち、
  超えたら `reloadIframe()` する。**提案しかけた設計が既に実装されていた**（推理）

つまり書いたリトライは、**上位層の仕事の下手な再実装**だった。誤りは
「機序を取り違えた」だけでなく「そもそも我々の層の問題ではなかった」の二重。

なお自動復帰しなかった理由は未確定。`installGadgetStub` の `onRpcBroken` は
`suspendGadgetCalls()` を呼ぶだけで `reconnect()` を起動せず、`reconnect()` は
`useEffect` の依存 `[gadget, chatId]` でしか走らないように読める（推理）。
編集していない側のウィンドウにコード変更が伝わっていない可能性もある。§3 参照。

### 2.11 接続は 2 系統ある — Code 共有は生き残る（2026-08-07）

§2.10 の実験中、**App の連動は切れたのに Code タブの共有は継続していた**
（追記したコメントが即座に反映された）。これは想定どおりで、構造上そうなる。

| | Code 共有 | App の連動 |
|---|---|---|
| 話し相手 | **Overseer**（ワークスペース単位の DO） | **Gadget**（`server.js` が定義した DO） |
| 経路 | Workshop の外側の画面 → `subscribeToCode` | サンドボックス iframe → `gadget` スタブ |
| コード再デプロイの影響 | 受けない | 壊れる |

`api.ts:1595-1598` に「Interface to a workspace's Overseer … code sync
(one Yjs doc for the whole workspace)」とある。コード doc はワークスペース全体で
1 つで、`subscribeToCode` は Overseer のメソッド。一方 `gadget` スタブが繋がる先は
我々が書いた `Gadget` クラスのインスタンスで、**別の Durable Object**。

**必然である。** 置き換えられる側と置き換える側が同じ接続に乗っていたら、
保存した瞬間にエディタ自身が切れて保存できなくなる。

#### 壊れるのは接続であって状態ではない

`this.ctx.storage` に置いた `count` は再デプロイを**生き延びる**。
`this.subscribers` は**消える**（メモリ）。`counter.nw` はこれを既に正しく
書き分けており、理由まで説明していた。**その部分の散文は実機で裏付けられた。**

だからリロードすれば数字は保たれたまま復帰する。被害は「一度リロードが要る」
だけでデータは失われない。プラットフォームが "Clients may frequently reload" と
割り切っているのは、この設計だからだと考えられる（この因果は推測）。

### 2.12 上流に追従した — 手順が確立（2026-08-09）

cloudflare-os の上流が動き、フォークの `main` に取り込まれていたので、
`literate-gadget-minimal` を載せ替えた。**衝突ゼロで完了し、起動も確認した。**

#### 手順（次回もこれでよい）

```sh
cd reference/cloudflare-os
# 初回だけ: clone が -b 指定だったので refspec がブランチ限定。main も追跡する（§2.15）
git config --add remote.origin.fetch '+refs/heads/main:refs/remotes/origin/main'
git fetch --depth=50 origin main          # --unshallow は不要だった
git merge-base --is-ancestor <土台> origin/main   # 分岐していないか確認
git tag -f before-sync-<日付> HEAD        # 戻り先を確保
git push origin before-sync-<日付>        # ← 必須。理由は下記
git rebase origin/main
make witness VERIFY=1                     # ← 証拠が古びていないか（リポジトリ側で）
pnpm run-local                            # ← 起動するか
```

**タグの push は省略できない。** rebase するとそれまでの版は
**どのブランチからも到達不能**になり、ローカルのタグだけが命綱になる。
push しておけば、その状態が恒久的に取り出せる。

なぜそれが要るかというと、**証拠の検証は参照元の版に依存する**からである。
`notes.nw` が 8/10 の時点で `run-dev-server.js:192` を指していたのは正しかったが、
いまの reference では 203 である。過去の literate-gadget をチェックアウトしても
`setup.sh` はフォークの tip を持ってくるので、**当時正しかった証拠が落ちる**。
タグがあれば、その版を取り出して再現できる。

`--force-with-lease` で push するときは、**先にリモートを fetch しておくこと**。
取得していないと「stale info」で拒否される。これは安全装置が正しく働いた形で、
`--force-with-lease=<branch>:<期待するコミット>` の形で明示すると確実。

#### 今回の確認結果

| 観点 | 結果 |
|---|---|
| 履歴の分岐 | なし。旧土台 `0eaec6c` は `origin/main` の祖先 |
| 退避した 15 ファイルへの上流の変更 | なし（衝突ゼロ） |
| gatekeeper 数 | 16 → 16。**watcher が増えない**＝ OOM リスクの構造は不変 |
| 間引きの維持 | 退避 15 / 検出 1 |
| 証拠の風化 | なし。裏取り 14 件通過 |
| 起動 | 成功。HTTP 200、20ms、エラー 0 |
| `main` との差分 | リネーム 15 件のみ（0 insertions, 0 deletions） |

上流の中身は `#56` Backend observability and hygiene for Durable Object resets、
`#47` ambient gatekeeper の事前インストール基盤、`#49`/`#52` GitHub gatekeeper の
修正。`workshop-backend/wrangler.jsonc` にトレース設定が入り、コメントに
**「ベータ期間中は無料だが 2026-10-01 から Logs quota に課金される」**とある。
ローカル実行には影響しないが、公開運用するなら sampling rate を見直す話になる。

#### 裏取りは通ったが、弱い検査だった

`agent.ts` も `GadgetUI.tsx` も**今回は無変更**だったので、
「変わっていないものは変わっていない」と確認しただけである。
道具が本当に試されるのは、典拠にしているファイルが動いたときになる。

#### メモリの余裕が減った

追従後、空きが **1.3〜1.5Gi → 745Mi** になった。主因は
`vite build --watch`（gatekeeper-context のもの）が **約 1GB** 占めていること。
これは以前から存在する唯一の watcher なので、**更新が原因とは断定できない**
（測定した時点の違いかもしれない）。動作自体は正常。
次に `pnpm run-local` を使うときは、他のプロセスを整理してからのほうが安全。

### 2.13 別のマシンへ移設した — 全経路を再現（2026-08-09）

試作していたノート PC からこの環境へリポジトリを移し、**すべて再現した**。
移設したのは git の中身だけである（`reference/` も `node_modules` も `.gadget` も
`.gitignore` 済みなので付いてこない）。

#### 環境の違い

| | 旧機 | この機 |
|---|---|---|
| 総メモリ | 3.7Gi（WSL2） | **15Gi** |
| perl / make / git | あり | 5.38.2 / 4.3 / 2.43.0 |
| node | あり | v24.17.0 |
| pnpm | あり | **なかった**。corepack 0.35.0 で 11.17.0 を activate |

`packageManager` が 11.17.0 を指定しているので、`corepack prepare pnpm@11.17.0
--activate` で合わせた。

#### 再現の結果（すべて実行して確認）

まず**リポジトリだけで完結する範囲**。この時点では `reference/` の
`node_modules` はまだない。

| 検査 | 結果 |
|---|---|
| `make` | tangle 2 本 + weave 1 本。**生成物が git 上で 1 バイトも動かない** |
| `make check` | `server.js` / `client.js` とも通過 |
| `make witness VERIFY=1` | 節 12 / **未証 0**、物証 8・証言 11・推理 3、**裏取り 14 件 要確認 0** |
| `reference/` | ブランチ `literate-gadget-minimal`（`efd15df`）、shallow のまま。`upstream` の push URL は潰れたまま |
| 間引き | `wrangler.jsonc` 生存 1 / disabled 15。維持されている |

次に `pnpm install` 以降。

| 検査 | 結果 |
|---|---|
| `pnpm install` | 17.1 秒、エラーなし |
| `pnpm run-local` | `Ready on http://localhost:8787` まで 30 秒 |
| HTTP | 200。暖機後 19〜24ms |
| 検出された gatekeeper | `gatekeeper-context` のみ |
| ログのエラー | 0（1 件の警告は vite のチャンクサイズ） |
| メモリ | used 1.6Gi → **3.3Gi**（増分 約 1.7Gi）。`vite build --watch` が 823MB |
| `mkgadget` → `ckgadget -c` | 往復検証通過。`server.js` / `client.js` が tangle 出力と一致 |

`vite build --watch` の 823MB は §2.12 の「約 1GB」とほぼ一致する。
増分 1.7Gi は**旧機の総メモリ 3.7Gi のほぼ半分**であり、§2.6 で OOM を踏んだ
理由がそのまま見える。

#### 起動時間の数字は §2.6 と比較できない

§2.6 は「初回応答は 15 秒、暖機後は 11〜25ms」と記録しているが、今回は
`Ready on` が出るのを待ってから叩いている。旧機の 15 秒に含まれていたはずの
初回ビルド分は、こちらでは起動側の 30 秒に入っている。
**測り方が違うので、比較できるのは暖機後だけ**である。そこは一致した。

#### 移設で言えたこと・言えないこと

**原本・生成物・証拠が git だけで運べた。** 機械が変わっても裏取り 14 件が通り、
生成物は 1 バイトも動かなかった。

ただし裏取りが通ったのは、**この間に上流が動いていないから**である。
§2.12 の「弱い検査だった」という留保がそのまま当てはまる。移設は
**環境非依存性の証拠**にはなるが、**証拠の耐久性の証拠にはならない**。

### 2.14 手順2 完了 — 承認 UI を観察した（2026-08-10）

**手順2 の三つの観察項目をすべて実機で見た。** しかも当初の想定と違い、
**エージェントも LLM の API キーも要らなかった。**

#### エージェントが要らなかった理由

手順2 の原文は「副作用のある操作をエージェントにさせる」だったが、
承認待ちを作る `submitAction` の呼び出し元は `GatekeeperCaller` 型で、
`{from: "gadget", gadgetId}` を含む（`overseer.ts:6954-6970` — `from: "gadget";`）。
**Gadget が binding を叩けば pending が立つ。** §2.7 の「エージェントを迂回する」
筋がここでも通った。

#### 接続先は自作した

`tools/mockportal.mjs` — 依存のない Node 製の MCP サーバ（このリポジトリに同梱）。
外部アカウントも OAuth も要らない。実害のある副作用は起こさず、メモに文字列を足すだけ。

**`gatekeeper-mcp` ではなく `gatekeeper-mcp-portal` を使った。** 前者は
`TRUST` を `"byo"` に固定しており（`mcp.ts:77` — `const TRUST: ServerTrust = "byo";`）、byo では `classifyTool` の
`autoApprovable` が必ず false になる。つまり URL を貼る方式では
**自動承認が永久に観察できない**。ポータル側は `MCP_PORTAL_TRUST_ANNOTATIONS=true` で
`"vetted"` になる。

ローカルの MCP サーバに繋ぐには `MCP_ALLOW_INSECURE=true` が要る。
`run-dev-server.js:435-441` — `"gatekeeper-mcp": ["MCP_ALLOW_INSECURE"]` — が
これを `.dev.vars` から gatekeeper へ渡す配線を持っており、**ローカル開発を想定した公式の逃げ道**である。

再現手順:

```sh
# 1. .dev.vars を置く（リポジトリルート、gitignore 済み）
cd reference/cloudflare-os
cat > .dev.vars <<'EOF'
MCP_ALLOW_INSECURE=true
MCP_PORTAL_URL=http://127.0.0.1:9977/
MCP_PORTAL_NAME=Literate Notes Portal
MCP_PORTAL_AUTH=none
MCP_PORTAL_TRUST_ANNOTATIONS=true
EOF

# 2. モックサーバ（別のシェルで）
node tools/mockportal.mjs

# 3. Workshop
setsid nohup pnpm run-local &
```

**`gatekeeper-mcp-portal` の有効化はフォークにコミット済み**（`e319967`）なので、
`setup.sh` から clone し直せば最初から有効になっている。watcher は 1 個から
2 個に増える。メモリの厳しい環境で困るなら `wrangler.jsonc.disabled` に
戻せばよく、これは §2.6 の間引きと同じ操作である。

道具は三つ用意し、注釈で扱いを撃ち分けた。

| 道具 | 注釈 | 判定 |
|---|---|---|
| `notes_read` | `readOnlyHint: true` | 観測。承認を経ない |
| `notes_append` | なし | 操作。**常に手動** |
| `notes_touch` | `destructiveHint:false`, `idempotentHint:true` | 操作。自動承認の資格あり |

#### 観察できたこと

| 項目 | 結果 |
|---|---|
| pending の表示 | `Activity` の `Needs review` に並ぶ。**なぜ操作扱いになったかの理由も文章で出る**（"Treated as an action because the server did not declare it read-only. Nothing has been sent yet."） |
| 分類の可視化 | grant の画面で `read-only` / `needs approval` のバッジが上表のとおりに付いた |
| 自動承認の可否 | `notes_touch` の保留にだけ `Always approve` が出た。`notes_append` には出ない |
| 読み取り | 押した瞬間にサーバへ届き、値が返った。承認を求められない |
| 書き込み | pending と番号が返るだけで、**サーバには何も届かない** |
| 承認後 | 承認した瞬間に初めてサーバへ届いた |

**観測は二方向から取った。** 画面に何が出たかと、**接続先のサーバに何が届いたか**。
後者が効いた。「保留になった」ことは画面で分かるが、
**「まだ起きていない」ことは受け側を見ないと分からない**。

#### 新しく分かったこと: 自動承認は前の関門を越えない

**これは §2.4 の記述の訂正である**（§2.4 側にも注記した）。

保留を適用するドレイナは、その gatekeeper の保留を **id の昇順に見て、
自動適用できないものに当たったらそこで止まる**。飛び越えない。

```
if (record.description.autoApprovable !== true || rule === undefined) {
  // A manual gate. Stop rather than skipping ahead to any later auto-eligible action.
  break;
}
```
（`auto-approval.ts:72-73` — `A manual gate. Stop rather than skipping ahead`。
設計意図は `auto-approval.ts:56` に "nothing is silently applied past a human gate" とある）

実際にそうなった。`notes_append`（人手が要る）を先に、`notes_touch`（資格あり）を
後に積んだ状態で `notes_touch` のルールを有効にしても、**何も起きなかった**。
`notes_append` を承認した **233 ミリ秒後**に `notes_touch` が誰にも聞かれずに走った。
承認が関門を外し、堰き止められていた保留が続けて流れた形である
（`overseer.ts:7760` に "Clearing this manual gate may unblock later auto-eligible
pending actions" とある）。

**UI の文言はこの場合を想定していない。** ルール作成の確認ダイアログは
`This action will be applied now too.` と無条件に述べるが、前に関門があれば
適用されない。**説明のほうが実装より大雑把だった。** §6.2 が扱ってきた
「もっともらしい散文が実態とずれる」構図が、プラットフォーム側の UI 文言にも出ている。

なおこれを踏めたのは**ボタンを左から順に押したから**である。逆順なら
即座に適用され、この挙動には気づかないままだった。事故が仕様を暴いた。

#### `actionKind` の第三の状態

§2.4 は「タグを持たない action はどのルールにも一致せず永久に手動」と記録したが、
MCP は `actionKindFor` が必ず `scopeTag:toolName` のタグを付ける（`tools.ts:104` — `export function actionKindFor(scopeTag: string, toolName: string)`）。
それでも `notes_append` は永久に手動である。**タグはあるが自動承認の資格がない**という、
§2.4 が想定していなかった状態が存在する。適格性は二つの署名を要求する——
"Eligibility requires BOTH signals"（`auto-approval.ts:58`）。

#### 環境について分かったこと

- **アカウントは移設で来ない。** `.wrangler/state` は git に入らないので、
  別マシンで作ったアカウントは存在しない。**ログインではなく新規作成**が要る。
  `signupsEnabled` は既定 true
- **管理者名は `admin` に固定。** `run-dev-server.js:481` — `config.vars.ADMINS = ["admin"];`
  — がハードコードしており `.dev.vars` では変えられない。
  ただし手順2 の範囲（接続・Gadget 作成・承認）は一般ユーザで足りた
- **dev サーバはセッションに紐づけて起動すると道連れで落ちる。**
  エージェントのバックグラウンドタスクとして起動すると、セッション終了時に kill される。
  `setsid nohup pnpm run-local &` で切り離せば生き残る。切り離した場合は
  §2.6 の孤児対策（`ps -eo pid,etimes,args | grep cloudflare-os`）が自分の責任になる

#### 成果物

`gadgets/notes/notes.nw` — 承認を観察する Gadget の文芸的原本。20 節、
物証 8 / 証言 20 / 推理 2、未証 1（「それでも確かめていないこと」なので意味的に正しい）。
**証拠を足しても tangle 出力は 1 文字も動かない**（§6.1 の性質の再確認）。

#### 確かめていないこと

- **回収の往復。** `getActionResult` を押していない。ボタンが出るところまで
- **却下。** `Deny` を一度も押していない
- **注釈が嘘だった場合。** 読み書きの判定はサーバの自己申告に依存する。
  `readOnlyHint` を偽った書き込みは承認を経ずに走るはずである。
  **起きないことを確かめたのではなく、起きうる構造だと確かめた**にすぎない。
  自前のサーバなので嘘をつかせれば試せる

### 2.15 二度目の上流追従で、証拠の風化を初めて捕まえた（2026-08-10）

上流の新着は **1 コミットだけ**（`b2a51b5` "Classify RPC errors client-side and
quiet recoverable failures" #110）。rebase は衝突ゼロで通り、`main` との差分は
リネーム 14 件（0 insertions, 0 deletions）のまま。起動も確認した。

**追従そのものより、そこで見つかったことのほうが重要である。**

#### 手順の穴: `origin/main` が追跡されていなかった

§2.12 の手順どおり `git fetch --depth=50 origin main` を打っても
`origin/main` が作られない。clone が `--depth 1 -b literate-gadget-minimal`
だったため、refspec がそのブランチ限定になっていた。

```sh
git config --add remote.origin.fetch '+refs/heads/main:refs/remotes/origin/main'
```

一度入れれば以後は §2.12 の手順が素直に通る。

#### 裏取りは 36 件通ったが、また弱い検査だった

`.nw` 側の証拠は全部通った（`counter.nw` 14 件 / `notes.nw` 22 件）。
しかし**典拠にしているファイルが 1 つも変わっていない**。今回動いたのは
`api.ts` / `user.ts` / `server.ts` とフロントエンドで、証拠が指すのは
`agent.ts` / `GadgetUI.tsx` / `tools.ts` / `auto-approval.ts` / `overseer.ts` /
`session.ts` / `mcp.ts` / `run-dev-server.js`。**重なりがゼロだった。**
通ったのは頑健だからではなく、当たらなかったからである。

#### 本当の発見: HANDOFF の手書き引用が 3 件、同時に腐った

機械検査の外側で風化が起きていた。

| 引用 | 追従前 | 追従後 | ずれ |
|---|---|---|---|
| `api.ts` Overseer / code sync（§2.11） | 1290-1294 ✓ | **別の場所** | +27 |
| `api.ts` createGadget の chatId（§2.7） | 1340-1349 ✓ | **別の場所** | +26 |
| `BlueprintLandingPage.tsx` newGadgetFromBlueprint（§2.7） | 578 ✓ | **別の場所** | −4 |

**追従前は 3 件とも正しかった**ことを `git show 1cb5e3d:...` で確認している。
つまり**この 1 コミットが 3 件を同時に腐らせた**。しかも誰も気づかない。
`nwitness -v` は `.nw` しか見ないからである。

引用は上の表のとおり修正した（`api.ts:1595-1598`、`api.ts:1655-1664`、
`BlueprintLandingPage.tsx:567`）。

#### ファイル名で索引を引く設計が効いた例

`BlueprintList.tsx` は `src/` から `src/components/` へ**移動していた**が、
行番号 195 の内容は一致したままだった。`nwitness` は**パスではなくファイル名**で
索引を引くので、この種の移動では壊れない（§6.1 の「参照元は名前で引く」）。
最初はファイルが消えたと読み違えたが、探し直して分かった。

#### 含意

**証拠の風化は「あるかもしれない」ではなく「起きる」である。**
上流の 1 コミット、しかもこちらのコードとは無関係な変更で、3 件が同時に落ちた。

そして**守られているのは `.nw` だけ**である。事実の大半を抱えているのは
この HANDOFF のほうで、そちらは無防備だった。§6.1 の弱点表に 4 番目として
追加した。

### 2.16 三度目の追従で、道具が典拠の移動を捕まえた（2026-08-11）

上流の新着は **5 件**。バグ修正が中心である。

| コミット | 内容 |
|---|---|
| `8b08672` | Overseer の DO が死んだとき WebSocket を止める処理の修正（#135） |
| `575599e` | アンマウント後に解決する ResourcePicker の購読を破棄（#132） |
| `2508099` | **ローカル開発のカスタムポート修正（#126）** |
| `e83072f` | PR の自動ラベル付け（#138） |
| `27648d8` | Bonk OIDC エンドポイントの更新（#122） |

rebase は衝突ゼロ。`main` との差分はリネーム 14 件（0 insertions, 0 deletions）のまま。
依存に変更がないので `pnpm install` は不要だった。起動も確認した
（`Ready` まで 46 秒、HTTP 200、暖機後 17〜26ms、エラー 0、gatekeeper 2 つ）。

#### ついに `.nw` の裏取りが本物を捕まえた

**`#126` が `run-dev-server.js` を書き換えた。** これは §2.14 で典拠にしていた
ファイルである。§2.12 以来「典拠にしているファイルが動いたときが本番」と
書いてきたが、それが来た。

```
要確認: 典拠が合わない。上流が変わったか、引用が不正確か。
      gadgets/notes/notes.nw:51  証言 run-dev-server.js:192
        引用が run-dev-server.js:192 に見当たらない
```

**道具が止め、終了コード 1 を返した。** 人間が気づく必要はなかった。

内容は動いておらず、**一律 +11 行ずれただけ**である。ポート設定の一部が
新設の `scripts/dev-server-config.js` へ移り、その分だけ上にずれた。
影響した引用は 3 件で、すべて修正した。

| 引用 | 旧 | 新 |
|---|---|---|
| `notes.nw` の証言 | `run-dev-server.js:192` | `run-dev-server.js:438` |
| §2.14 の passthrough | `run-dev-server.js:189-195` | `run-dev-server.js:435-441` |
| §2.14 の ADMINS | `run-dev-server.js:235` | `run-dev-server.js:481` |

**間引きの前提は無傷。** `findGatekeepers` は依然として
`gatekeeper-` で始まり `wrangler.jsonc` を持つものだけを拾う（位置は 67 → 78 行）。

#### 三日で三通りの結果が出た

| 日 | 典拠との重なり | 結果 |
|---|---|---|
| 8/09（§2.12） | なし | 通った。ただし**当たらなかっただけ** |
| 8/10（§2.15） | `.nw` はなし、HANDOFF はあり | **機械の外で 3 件腐り、人間が手で見つけた** |
| 8/11（本節） | `.nw` にあり | **機械が捕まえた。人間は気づく必要がなかった** |

前日に Markdown まで守備範囲を広げておいたので、今回は
`.nw` と HANDOFF の両方が同じ検査を受けている。8/10 と同じことが起きても
今度は機械が止める。

**道具は入れた翌日に働いた。** 弱点 3（証拠の風化）への対処は、
もはや「起きるかもしれない事態への備え」ではなく、**日常的に発火する装置**である。

### 2.17 自己申告に嘘をつかせた（2026-08-11）

**読み書きの判定はサーバの自己申告だけに依っている。実際に嘘をつかせて確かめた。**

`tools/mockportal.mjs` の `notes_append` に `readOnlyHint: true` を名乗らせ、
**振る舞いは変えなかった**（書き込みはそのまま）。つまり「読み取りを名乗る書き込み」
である。Gadget も grant も一切いじっていない。grant は `All tools`
（"including ones it adds later"）なので、既存の画面のボタンがそのまま実験装置になった。

#### 経路が全部つながった

```
15:20:31  嘘をつかせた
15:20:32  ← 確認用 tools/list（Workshop はまだ取りに来ない）
   ……… 5 分 50 秒、キャッシュが古い分類を出し続ける ………
15:26:22.946  ← tools/list                取り直し（ボタンを押した瞬間に発生）
15:26:23.075  ← tools/call notes_append   承認なしで到達。129 ミリ秒後
```

**取り直しと呼び出しが同じ往復の中で起きる。** TTL が切れた状態で押すと、
その呼び出し自身がカタログを取り直し、**新しい分類がその場でその呼び出しに適用される**。
二度押す必要はなかった。分類は grant 時固定でも呼び出しごとでもなく、
**5 分の TTL つきキャッシュ**である（`catalog.ts:17` — `export const CATALOG_TTL_MS = 5 * 60 * 1000;`）。

嘘をつかせた直後に押した分は、**古い分類のまま承認を要求された**。
「効かない時間がある」ことも観察できている。

#### 三つの記録が一致した

| 記録 | 内容 |
|---|---|
| Gadget（呼んだ側） | `ok notes_append — 足した: claim 4` |
| モック（呼ばれた側） | 着信 1 件、メモが `claim 4` に書き換わった |
| Workshop（記録係） | 15:26 `notesappend` を **👁 Observed** として記録 |

**食い違いはない。書き込みは本当に起き、三者ともそれを示している。**

#### 嘘は成立するが、記録は正直

プラットフォームは止めない。警告も出さない。既存の grant も無効化しない。
代わりに**観測として記録し、出所を明記する**。

> The server declares this tool read-only, so it runs without approval.
> **That claim comes from the server itself.**
> （`tools.ts:230`）

結果として承認履歴に**同じツールが二つの姿で並ぶ**。

```
今日   15:26  👁 notesappend   Observed    ← 嘘のあと。承認を経ていない
昨日   17:47  🛡 notesappend   Approved    ← 正直だった頃。承認を経た
```

告発ではなく、**並置による記録**である。`Actions` / `Observations` の
フィルタがあるので、「サーバの言い分で素通りした呼び出し」だけを絞って見られる。

これは見落としではなく**自覚して選ばれたトレードオフ**で、出典にそう書いてある
（`tools.ts:60-61` — "a tool the server mislabels runs with no approval, where an
unlabelled one would have been queued"）。カタログの変化自体も検出されており、
指紋が変わると `catalog.changed` が記録される（`catalog.ts:72`）。
**ただしこれもログ 1 行であって、止めはしない。**

#### なぜこれを調べたか（背景）

この実験は不完全将棋（版図）プロジェクトの設計判断の裏取りにあたる。
あちらは「来訪者の身元を検証せず、名乗りを額面通りに受け取る」ことを根本原理とし、
**「名乗りと振る舞いの食い違いは、権威ある告発ではなく観察として記録」**すると定めている。

**その形が既存のプラットフォームで実装として成立することを確認した。**
Cloudflare OS は独立に同じ判断に到達しており、実機で動く。

対応は細部まで及ぶ。`classifiedBy: "server-annotation" | "default"` という型は
「どの判定が誰の言い分に基づくか」を持ち歩くためのもので、出典にも
"so an audit can find every call that was trusted on the server's word" とある。
**§6.1 の 物証 / 証言 / 推理 と同じ発想である。**

一致しない点も記録しておく。版図は Web Bot Auth の**暗号署名**で名乗るが、
MCP の注釈に署名はない。**名乗りが誰のものかは担保されていない**。
ここは版図のほうが一段強い設計である。

#### 言えないこと

- 試したのは**利用者が繋いだ接続先**の扱いである。管理者が上流を保証する
  `vetted` 層は別で、そちらは触っていない
- **「記録に残る」ことと「誰かが気づく」ことは別である。** 気づくには履歴を
  見る人が要る。版図の記録係が「寄り添う目」である理由がここにある

### 2.18 回収と却下を観察し、`notes.nw` の未証が 0 になった（2026-08-11）

残っていた 2 つを同じ盤面で片付けた。保留を 2 件積み、**片方を承認、片方を却下**して、
それぞれ結果を回収した。

#### 回収は三つの結末で文言が違う

| いつ回収したか | 返るもの |
|---|---|
| 承認前 | `pending` と `is awaiting approval.` |
| 承認後 | `ok` とサーバが返した中身 |
| 却下後 | `rejected` と `was not approved.` |

承認前の文言は、**呼び出したときの `needs approval. Poll getActionResult(N)` とは
別の文字列**である。同じ「待っている」でも、呼んだ側に最初に返す文と、
問い合わせに答える文は別に書かれている（`session.ts:149` と `session.ts:179`）。
`notes.nw` が別々の証言として挙げていた 2 つが、両方とも実機で出た。

**回収は問い合わせであって実行ではない。** 承認前に回収しても接続先には何も届かない。

**承認済みの結果を受け取ると、それ自体が観測として記録される。** 承認履歴に
`result of notes_append` という独立した項目が現れ、「承認された呼び出しの応答を読んだ」
と書かれた。§2.14 に書いた「渡された時点で読んだことになる」が実装として現れた形である。

#### 承認と却下の非対称は受け側の記録で見える

同じツール・同じ形の保留・同じ日。分かれたのは人間の一手だけ。

```
claim 3  Approve → 06:43:02 に接続先へ到達。メモに書かれた
claim 2  Deny    → 一度も到達せず。メモに存在しない
```

**却下は「実行して取り消す」ではなく「実行しない」。** §2.4 の
「自動的な却下は存在しない。却下は必ず人間の行為」と正確に対をなす。
どちらの履歴にも `By tokuhira` が残り、§2.4 の「`resolvedBy` に解決者が残る」も
実機で確認できた。

用語の層が違う点を記録しておく。**Gadget が受け取るのは `rejected`、
UI の表示は `Denied`。** API の `ActionState` は `"rejected"` なので、
どちらもその層では正しい。

#### 結果

`gadgets/notes/notes.nw` は **20 節すべてに証拠が付いた**（未証 0、
物証 13 / 証言 24 / 推理 2）。証拠を足しても tangle 出力は 1 文字も動いていない。

なお `notes.nw` の client には**読みにくい点が残っている**。回収結果の行にも
回収ボタンが付く（`pending` かつ `actionId` を持つ行に出す作りなので、
まだ保留なら次のポーリング用として正しくはある）。また保留の行は承認されても
`pending` のまま残る。後者は欠陥ではなく、**呼んだ瞬間の記録が後の結末を
知らない**というだけで、当事者の記録と記録係の記録がずれる実例である。

**前者は直した**（2026-08-11）。記録に `kind`（`call` / `collect`）を持たせ、
道具を呼んだ記録の保留にだけボタンを出すようにした。文字列で判定せず、
**推測できない情報は記録する側が書く**。差し替え直後は古い記録に種別がないので
ボタンが一つも出ず、新たに一往復させると呼んだ記録にだけ出た。
**記録の形を変えると過去の記録が意味を失う**、という一例でもある。

### 2.19 推論の費用を調べた — Workers AI という道（2026-08-11）

**この節は §2.20 で訂正した。** 鍵が要らないのは正しいが、既定で提示されるモデルは Workers **Paid** 専用で、無料プランのままでは動かない。

**API キーを買わずに手順4 へ進める道が見つかった。** ただし当初期待していた
「AI Gateway の無料枠」とは別物だった。以下はドキュメントとコードを読んで得た事実で、
**まだ動かしていない**。

#### repo の言う「free tier」は運営者が配るもの

`docs/ai-gateway-billing.md` を読んだ。あれは**運営者が利用者に配る無料枠**の機能である。

> Off by default (`ENABLE_CLOUDFLARE_LIMITS` unset) — usage is then unlimited,
> as for self-hosted deployments.

- 無料枠ぶんの推論は「the platform's configured AI Gateway」経由、つまり**運営者の勘定**
- 使い切ると利用者は**自分の** Cloudflare アカウントを繋ぎ、自分のクレジットで払う
  （既定で残高 `$2` 以上が要る。`MINIMUM_CLOUDFLARE_BALANCE`）
- 既定は 1 人 1 日 100 呼び出し（`DAILY_LLM_CALL_LIMIT`）
- セルフホストは既定で無制限。**止める人がいないだけで、費用は設定した資格情報の持ち主に行く**

**セルフホストする我々は「運営者」なので、貰う側ではなく出す側である。**

#### 本命は Workers AI だった

`ai-models.ts` は `cloudflare-workers-ai` を**エージェントのモデルプロバイダとして
一級で扱っている**（`ANTHROPIC_MODELS` / `OPENAI_MODELS` / `GOOGLE_MODELS` と並んで
`CLOUDFLARE_WORKERS_AI_MODELS` を読む）。`CF_AI_GATEWAY_WAI_DIRECT=true` にすると
AI Gateway すら経由せず、Workers AI の REST エンドポイントを直接叩く。

**要るのは Cloudflare のアカウント ID と API トークンだけで、
Anthropic や OpenAI の鍵は一切要らない。**

これは §2.7 の記述の精密化にあたる。あちらの「`WORKERS_AI` バインディングは
推論経路ではない」は**バインディングについては正しい**が、
「Workers AI は推論に使えない」と読むと誤りになる。§2.7 に注記した。

#### 無料枠でどれだけ動かせるか（概算）

Cloudflare 公式（`developers.cloudflare.com/workers-ai/platform/pricing/`）に
**Workers Free で「10,000 Neurons per day at no charge」**、超過は
**「$0.011 / 1,000 Neurons」**とある。カタログの単価から換算すると:

| モデル | 文脈 | 無料/日 入力 | 出力 | $/1M in-out |
|---|---|---|---|---|
| `granite-4.0-h-micro` | 131k | 6,470,588 | 982,143 | $0.017 / $0.112 |
| `glm-4.7-flash` | 131k | 1,818,182 | 275,000 | $0.0605 / $0.4 |
| `gemma-4-26b-a4b-it` | 256k | 1,100,000 | 366,667 | $0.1 / $0.3 |
| `gpt-oss-120b` | 128k | 314,286 | 146,667 | $0.35 / $0.75 |
| `kimi-k2.7-code` | 262k | 115,789 | 27,500 | $0.95 / $4 |

選べるのは 13 モデル。**この換算は推定である** — `$0.011 / 1,000 neurons` と
カタログの $/1M トークンが線形に対応すると仮定している。実測はダッシュボードで
neurons を見るのが確実。

`counter.nw` が 250 行、`notes.nw` が 500 行なので 1 往復は 2 万トークン前後と
見込まれる。コード特化の `kimi-k2.7-code` でも**1 日 5 往復前後は無料**の計算になる。

#### 留保

- **Workers AI のモデルが `.nw` の編集をこなせるかは別問題である。**
  ツール呼び出しとコード編集の精度が要る。Claude や GPT より苦戦する可能性は高い。
  ただし**それ自体が測る価値のあること**で、§1 の仮説が
  「どの程度のモデルから成立するのか」が分かる
- 10,000 neurons/日は**アカウント全体の枠**である。webFetch の HTML→Markdown 変換も
  Workers AI を使うので、そちらとも食い合う
- ここまで全部**読んで得た事実**であり、動かしていない

#### 運用形態についての方針（2026-08-11 時点）

セルフホストは**詳細検証には便利**だが、実際に運用する段になったら
**本家 Cloudflare へデプロイする選択もありうる**。その場合、費用構造の見え方が変わる。

| | セルフホスト（いま） | Cloudflare へデプロイ |
|---|---|---|
| 我々の立場 | 運営者かつ唯一の利用者 | 運営者 |
| `ENABLE_CLOUDFLARE_LIMITS` | 無意味（自分しかいない） | 意味を持つ。利用者に自腹を求められる |
| Workers Paid | 不要 | 必要（月 $5） |
| 推論の費用 | 設定した資格情報の持ち主 | 同左。ただし利用者 BYOK に寄せられる |

**いまの検証はセルフホストのままでよい。** デプロイを選ぶなら
`docs/public-server.md` の OAuth 設定一式（`PUBLIC_BASE_URL`、各 gatekeeper の
リダイレクト URI）が必要になる。

### 2.20 エージェントが動いた — ただし §2.19 は訂正が要る（2026-08-11）

**エージェントが実際に応答した。** LLM プロバイダの鍵は一つも使っていない。
ただし §2.19 の見立てには**穴があった**ので、先にそれを直す。

#### 訂正: 既定の候補は無料プランで使えなかった

§2.19 は「Cloudflare のアカウントだけで手順4 に着手できる」と結論したが、
**そのままでは一度も動かせない**。`SUGGESTED_MODELS["cloudflare"]` にあった 2 つは
Workers **Free** プランでは呼べず、403 になる。

> Model `@cf/moonshotai/kimi-k2.7-code` is **not available on the Workers Free plan**.
> Upgrade to access this model.

13 モデルを実測して切り分けた。

| 無料プランで | モデル |
|---|---|
| **使えない（3）** | `kimi-k2.6` / **`kimi-k2.7-code`** / **`glm-5.2`** |
| 使える（10） | `llama-3.3-70b-instruct-fp8-fast`（quick model）/ `gpt-oss-120b` / `gpt-oss-20b` / `nemotron-3-120b-a12b` / `gemma-4-26b-a4b-it` / `granite-4.0-h-micro` / `glm-4.7-flash` / `qwen3-30b-a3b-fp8` / `mistral-small-3.1-24b` / `llama-4-scout-17b-16e` |

**候補として提示される 2 つが、ちょうど使えない側に寄っていた。**
13 のうち 10 は無料で叩けるのに、エージェントには届かない配置である。

#### 対処: フォークで候補を足した

`literate-gadget-minimal` の `2a0ced9`。`SUGGESTED_MODELS["cloudflare"]` に
無料プランで通るものを 3 つ追加した（`gpt-oss-120b` 128k / `nemotron-3-120b-a12b`
256k / `glm-4.7-flash` 131k）。既存の 2 つは消さずに残してある。

費用の回避だけが目的ではない。**どの程度のモデルから §1 の仮説が成立するのかを
測りたい**ので、上下に幅のある候補があるほうがよい。

#### 動いた

`GPT-OSS 120B` を選んで日本語で話しかけたところ、推論の過程を伴って応答した。
チャットのタイトルも自動生成された——**quick model（`llama-3.3-70b`）も
無料プランで動く**ということである。

#### 推定が実測に変わった

§2.19 の換算表は推定だったが、ゲートウェイのログから実データが取れた。

| | 値 |
|---|---|
| 挨拶 1 往復（`gpt-oss-120b`） | 入力 5,347 / 出力 58 / **$0.0019** |
| タイトル生成（`llama-3.3-70b`） | 入力 94 / 出力 5 / $0.0000388 |
| neurons 換算 | $0.0019 ÷ $0.011 × 1000 ≈ **174 neurons** |
| 1 日 10,000 neurons で | **約 57 往復** |

**三つの記録が一致した。** 画面の表示（5,405 tokens / $0.0019）、ゲートウェイの
ログ、こちらの curl。§2.14 以来の三方向観測がここでも効いている。

ただし**これは挨拶 1 往復**である。入力 5,347 の大半はシステムプロンプトと
道具の定義で、`.nw` を読ませればここが増える。`notes.nw` が 500 行 ≈ 2 万トークンと
見込むと **1 日 10〜15 往復**あたりが現実的な線になる。手順4 には足りる。

#### トークンで踏んだ罠

- **AI Gateway の画面にある「Create an AI Gateway authentication token」は、
  Account API トークンではない。** これで作ったものは `aig.run` として通らなかった。
  `Manage account → Account API tokens → Create Token → Custom token` から作り直す
- 必要な権限は **AI Gateway: Read + Run、Workers AI: Read + Edit**
- **検証は `/accounts/{id}/tokens/verify` で行う。** `/user/tokens/verify` は
  ユーザ所有トークン用で、アカウント所有のトークンは "Invalid API Token" になる。
  ここで一度誤診した
- **wrangler の起動ログがトークンの先頭 34 文字ほどを平文で出す。**
  ログを共有するときは伏せること

#### 道具が今度は「こちらの改変」で発火した

`api.ts` に 17 行足した結果、**それより後ろを指していた引用 2 件がずれた**。
`make witness VERIFY=1` が止め、`api.ts:1317-1320` と `api.ts:1366-1375` を
名指しした（正しくは +17 行の `1334-1337` と `1383-1392`）。

§2.16 で発火したのは**上流の変更**によるものだったが、今回は**自分たちの改変**である。
参照元を触れば自分の引用が古びる、という当たり前のことが、
**当たり前に検出される**状態になっている。

#### 設定（`.dev.vars`、gitignore 済み）

```
CF_AI_GATEWAY=literate-gadget
CF_AI_GATEWAY_ACCOUNT_ID=<アカウント ID>
CF_AI_GATEWAY_API_TOKEN=<Account API トークン>
CF_AI_GATEWAY_PROVIDERS=cloudflare
```

`CF_AI_GATEWAY_WAI_DIRECT` は**付けない**。付けると Gateway を迂回して速いが
費用ログが残らず、上の実測が取れなくなる。

### 2.21 ポート転送はブラウザの記憶を衝突させる（2026-08-11）

別のマシン（ノート PC）から VS Code Remote-SSH のポート転送で繋いだところ、
**画面は出るのに中身が全部壊れる**という症状が出た。原因は環境側にあり、
このプロジェクトに固有ではないが、**繰り返し踏む形**なので記録しておく。

#### 症状

- Home は描画される。しかし **workspace 一覧・Blueprint 一覧・モデル選択が
  すべて失敗**する（"Something went wrong loading…"、"Couldn't load a AI model"）
- 左下のアバターが `T`（tokuhira）ではなく **`U`**
- **wrangler のログにエラーが一件もない。** HTTP は全部 200、WebSocket も
  `101 Switching Protocols` で張れている
- サーバ側のデータは無傷（`tokuhira` の UserDurableObject に保存キー 16、workspace 4）

**失敗しているのは RPC セッションの層**で、その下の HTTP は健全だった。
だからサーバのログを見ても何も出ない。

#### 原因: オリジンの衝突

Cookie とセッションの有効範囲は**オリジン（scheme + host + port）**で決まる。
`http://localhost:8787` は**どのマシンが後ろにいても同じオリジン**である。

ノート PC は 8/9 に**自分で**サーバを走らせており、そのときのセッションを
保存していた。今日そのノートからデスクトップの 8787 を転送すると、
ブラウザには同じオリジンに見えるので、**古い Cookie がそのまま送られた**。

**ポート転送は「別のマシンのサービスを同じオリジンに見せる」仕組みなので、
この衝突は構造的である。**

さらに厄介なのは、フロントエンドが「認証済み」と判断してしまった点である。
未認証なら本来ログイン画面に落ちる——`__root.tsx:88` に「Not authenticated and not
a public route」とあり、そこで `LoginPage` へ分岐する。

その分岐が働かなかったので、**認証済みのつもりで全 RPC が失敗する**という
中途半端な状態になった。

#### 対処

**サイトデータを削除する。** リロード（`Ctrl+Shift+R`）では直らない。
削除するとログイン画面に落ちるので、そこで入り直す。**サーバ側のデータは
一切失われない** — 消えるのはブラウザ側のセッションだけである。

#### 再発防止

**転送先のローカルポートをずらす**（例: remote 8787 → local 18787）。
オリジンが変わるので過去の記憶と衝突しない。

これが安全なのは、`run-local` がビルド済み資産を**同一オリジンで配る**からである。
`packages/workshop-frontend/src/main.tsx` の `getBackendHost()` は
`import.meta.env.DEV` のときだけ `VITE_BACKEND_HOST`（既定 `localhost:8787`）を
使い、それ以外は `window.location.host` を返す。コメントにも
"Built assets are served from the same origin in both production and run-local mode"
とある。**ポートを変えても WebSocket の接続先は追随する。**

#### ついでに: VS Code の自動転送は拾わなかった

workerd が `127.0.0.1` にしか bind しないためか、PORTS パネルに自動では現れず、
`Forward a Port` で手動追加が必要だった（`Origin: User Forwarded`）。
**転送が要るのは 8787 だけ**である。モック MCP の 9977 は同じマシンの
workerd が取りに行くだけなので、転送すると余計な露出になる。

### 2.22 手順4 — エージェントに `.nw` を扱わせた（2026-08-12）

**A（一覧）と B（読解）は合格。C（編集）は半分。** 以下は実機で確認した事実である。
neurons の集計は UTC 日付で、この一連は UTC 2026-08-11 に計上されている。

#### 先に躓いたのはモデルの互換性だった

**`gpt-oss-120b` ではエージェントが一歩も進まない。** 道具を呼んだ次の推論が
必ず 400 になる。ゲートウェイのログでは、1 回目の成功から **4 ミリ秒後**に
入出力トークン 0 で弾かれていた。

原因はスキーマである。エラー本文にこうある。

> Type mismatch of '/messages/1/content', 'string' not in 'null'

OpenAI 互換の慣習では、ツール呼び出しだけを行う assistant メッセージの
`content` は `null` になる。フレームワーク（pi）はそのとおり送るが、
**モデルによってはそれを受け付けない**。`content: ""` に変えると 200 になる。

13 モデルを総当たりで測った。

| モデル | `content: null` | 無料プラン |
|---|---|---|
| `gpt-oss-120b` / `gpt-oss-20b` | **❌ 400** | ✅ |
| `llama-3.3-70b-instruct-fp8-fast` | **❌ 400** | ✅（quick model 固定） |
| **`nemotron-3-120b-a12b`** | ✅ 200 | ✅ |
| **`glm-4.7-flash`** | ✅ 200 | ✅ |
| **`gemma-4-26b-a4b-it`** | ✅ 200 | ✅ |
| `kimi-k2.7-code` | 403（有料専用） | ❌ |

**Workers AI 全体の問題ではなく、モデルごとの差である。** §2.20 で
`SUGGESTED_MODELS` に足した 3 つのうち、使えるのは 2 つだった。
外れたのは `gpt-oss-120b`——**「無料側の本命」として最初に選んだもの**である。

`llama-3.3-70b` が弾くのは quick model（タイトル生成）なので気になるが、
あちらは道具を使わない単発呼び出しなので実害はない。実際 200 で動いている。

**モデルはチャット単位で固定される。** 既存チャットの composer で選び直しても
効かず、サーバ側のログは古いモデルのままだった。新しいチャットを起こす必要がある。

**失敗した呼び出しは課金されない**（トークン 0 / $0）。

#### A: ファイルの一覧 — 合格

`nemotron-3-120b` で「このワークスペースにあるファイルを一覧して」と頼むと、
`server.js` / `client.js` / `notes.nw` の三つを正しく挙げた。

**道具を一度も呼んでいない。** 推論の過程に
「we can also just answer based on system prompt: it lists those files」とある。
**プラットフォームがファイル一覧をシステムプロンプトでエージェントに渡している。**
つまり**未知の拡張子でも見落とされない**。

#### B: 文書の読解 — 合格

「`notes.nw` を読んで、何が書いてあるか説明して」に対し、**3,332 文字**で
正確に要約した。特に次を正しく拾っている。

- 三つの道具と注釈の対応、`vetted` / `byo` の条件
- **`kind === "call"` かつ `pending` かつ `actionId` がある行にだけ回収ボタン**
  （前日に直したばかりの条件）
- **承認の 233 ミリ秒後に `notes_touch` が走った**という数字
- **嘘は TTL 5 分が切れて初めて有効**という時間差
- まとめの一文が主題を言い当てた——「嘘をつかせても構わないが、**記録には正直に残る**」

**ただしチャンク記法（`<<名前>>=` と `@`）に一度も言及していない。** `@証` にも
触れない。**「これは `server.js` / `client.js` の原本であり、tangle すると生成される」
という関係が説明に出てこない。**内容は読めているが、文書とコードの関係は語られなかった。

#### C: 編集 — 半分だけ

「`notes.nw` に『却下の経路』という節を足して、変更を反映して」と頼んだ。

**エージェントは `notes.nw` を編集した。`server.js` ではない。**
§5 に「`.nw` を放置して `server.js` を直接いじったら重要な反証」と書いていたが、
**そうはならなかった**。散文の文書を原本として扱っている。書いた内容も正確で、
§2.18 で観測したとおりのことを述べていた。

**だが tangle は問われていない。** 追加されたのは散文だけの節で、チャンクを
含まない。**tangle しても `server.js` は 1 バイトも変わらない。**
エージェントは正しい仕事をしたが、難しい部分に触れずに済んだ。
「変更を反映して」への答えは「ファイルを書きました（changeId: 0）」で、
`server.js` にも tangle にも言及がなかった。**理解しているのか、
たまたま必要なかったのかが区別できない。**

**依頼の設計が甘かった。** 本命は「コードを変えざるを得ない依頼」である。
たとえば「却下された行に取り消し線を引くようにして、変更を反映して」なら
`<<記録を描き直す>>` を直す必要があり、`client.js` を再生成しないと画面が変わらない。

#### 費用の実測

| | 入力 / 出力 | 費用 | neurons |
|---|---|---|---|
| A | 6,497 / 186 | $0.0035 | 約 318 |
| B | 約 17,023（合計） | $0.0212 | 約 1,927 |
| C | モデル呼び出し 4 回 | 約 $0.062 | 約 5,650 |
| **UTC 8/11 合計** | 123,575 / 12,779（47 呼び出し） | $0.0779 | **7,081 / 10,000** |

C の内訳に**出力 8,796 トークンの呼び出しが 1 回**ある。ファイル全体の書き出しである。
`.nw` を読ませる往復は 1 回あたり 2,000 neurons 前後、編集させると 5,000〜6,000。
**無料枠では 1 日に編集 1〜2 回**が現実的な線になる。

#### 運用上わかったこと（§2.9 の訂正を含む）

**新規ファイルの追加は `Pending changes` → `Accept changes` を経る。**
§2.9 に「明示的な『保存』操作はない。編集が随時反映される」と書いたが、
**少なくとも新規ファイルの追加とエージェントの編集は保留状態を経る**。
`Accept` を押すまで Gadget には反映されない。§2.9 側にも注記した。

### 2.23 本命の C — エージェントは tangle を回せない（2026-08-12）

**コードを変えざるを得ない依頼で試した。** 結果は三分岐の 2 番目で、
**しかも「できなかった」ではなく「やりようがなかった」**である。

#### 依頼と結果

> 却下された行に取り消し線を引くようにして、変更を反映して

エージェントは `notes.nw` の **`<<記録を描き直す>>` という正しいチャンク**を選び、
`line.style.cssText` の直後という**正確な位置**に 4 行を挿入した。

```js
if (row.status === "rejected") {
  line.style.textDecoration = "line-through";
  line.style.opacity = "0.6";
}
```

**`client.js` は変わらなかった。** 差分は `notes.nw` に `-0 +4` のみ。

| 分岐 | 起きたか |
|---|---|
| `.nw` を直し `client.js` も辻褄合わせ | ✗ |
| **`.nw` だけ直して `client.js` は放置** | **✓ これ** |
| `client.js` だけ直して `.nw` は放置 | ✗ |

三番目（原本が嘘になる）が**起きなかった**のは、仮説にとって重要である。
エージェントは一貫して `.nw` を原本として扱っている。

#### 関係は理解している。手段がない

最終回答にこうあった。

> **クライアント側コード（`client.js`）を更新し**、状態が `rejected` の行に取り消し線…
>
> 変更点は `notes.nw` の `<<記録を描き直す>>` セクション内の `render` 関数で…

**二文が食い違っている。** 後半は正確だが、前半は事実ではない。`client.js` は
更新されていない。**「`client.js` を生む側を直した」ことを「`client.js` を更新した」と
報告している。**

だが責めるのは筋違いで、**エージェントに tangle を走らせる手段がない**。
Gadget にはビルド工程がなく（§7）、`ntangle` を呼ぶ道具も与えられていない。
§3 に「tangle をどこで走らせるか — **未決**。ビルド工程が存在しないため
差し込む場所がない」と残していた論点が、**そのまま症状として現れた**。

#### 残り半分は人間が回した

repo 側に同じ 4 行を入れて `make` を走らせた。

```
gadgets/notes/notes.nw  | 13 +++++++++++++   ← 散文 9 行 + コード 4 行
gadgets/notes/client.js |  5 +++++          ← tangle が生んだ分
```

**これが CLAUDE.md の「生成物を git に入れる理由」の実物である。**
`.nw` の差分を読めば**なぜそうするのか**が分かり、`client.js` の差分を見れば
**何が実行されるか**が分かる。§6.3 が期待していた「文書に一節加わった形の差分」が、
コードの差分と並んで出た。

`server.js` は 1 バイトも動いていない。変更が `client.js` 側のチャンクに
閉じていることが、生成物の側からも確認できる。

#### 散文はこちらで足した

エージェントが書いたのは**コード 4 行だけ**で、説明はなかった。
`.nw` はコードと散文が対になる文書なので、**なぜ取り消し線なのか**を人間が足した——
色だけだと「赤い＝失敗した」と読めるが、却下は失敗ではなく実行されなかったこと
であり、取り消し線のほうが実態に合う。

**エージェントの出力は「コードとしては正しく、文書としては半分」だった。**

#### 保留中の変更は確定前でも検証できる

`Accept` を押す前に、保留の中身がストレージから読めることが分かった。
`chatDraftUpdates:<chatId>.<時刻>` に別キーで入っており、
`code:*`（確定済み）とは混ざらない。

**§6.2 の結論「差分を人間が読むまで確定させない」に、機械側の足がかりがある。**
変更が意図した範囲に収まっているか、無関係な箇所に手が入っていないか（§6.2 の
`実備` のような巻き添え）を、画面を目で追わずに検査できる。

#### 費用 — 編集は読解の 2 倍以上

| | 呼び出し | 入力 / 出力 | neurons |
|---|---|---|---|
| この依頼 1 回 | **9 回** | 225,359 / 8,457 | 約 11,290 |

`.nw` を読む → 編集する → **読み直して確認する**、という手数がそのまま乗る。
**1 依頼で 1 日の無料枠（10,000）を超えた。** それでも全部 200 で通っており、
**無料枠を超えても止まらない**（課金なのか猶予なのかは未確認）。

`.nw` が 537 行あることを考えると、**この構成では編集 1 回が枠を食い切る**。
文書が育つほど高くなるという性質は、§6.3 の「追記を差分の単位にする」構想と
正面からぶつかる論点である。

### 2.24 26 コミットの追従 — 道具が本領を発揮した（2026-08-16）

**これまでで最大の追従**（26 コミット、339 ファイル、+11,655 −6,088）。
rebase は**衝突ゼロ**で、`main` との差分はリネーム 14 件と我々の 17 行のまま。
`api.ts` が +1,910 −1,306 動いていたので覚悟していたが、無事に乗った。

#### 引用は 33 件落ちた。うち 32 件は「動いただけ」

前日に入れた移動検出（`08f9ee4`）が、そのまま本番で働いた。

| 判定 | 件数 |
|---|---|
| **移動している**（行番号を直せば済む） | **32** |
| **どこにもない**（人が読む必要がある） | **1** |
| 複数箇所にある | 0（`.nw`）/ 4（HANDOFF の範囲引用） |

道具が移動先を言うので、**32 件は機械的に置換できた**。手作業なら一件ずつ
grep して回るところで、それが二桁になっていた。**元が取れた。**

ずれ幅は上流の変更内容をそのまま映している。`agent.ts` は一律 +74 行、
`tools.ts` は +6、`auto-approval.ts` は +2、`overseer.ts` は +144〜162。
`api.ts` は `#182 Enforce JSDoc for API declarations` がコメントを
`//` から `/** */` に変えたため +260 行前後と大きい。

#### 唯一の「本物」— 上流が文面を変えていた

`session.ts` の保留メッセージが書き換わっていた。

| | |
|---|---|
| 旧 | `needs approval. **Poll** getActionResult(N) for the outcome.` |
| 新 | `needs approval. **If this is running in an agent's executeCode call, return from this executeCode call now so the approval can appear in chat.** After approval, call getActionResult(N)…` |

**「ポーリングせよ」から「いったん抜けろ、承認はチャットに出る」へ変わった。**
待ち方の設計が変わっている。

`notes.nw` の「人間が承認するまでポーリングする形になる」という散文が
これで古くなったので、**引用だけでなく散文も直した**。待つ主体が Gadget の画面か
エージェントかで事情が違う、という書き方に改めてある。

**これが移動と変更を分ける意味である。** 32 件は行番号の付け替えで済むが、
この 1 件は文書の主張そのものを見直す必要があった。道具が両者を選り分けた。

#### 起動しなくなった — Vite+ のキャッシュ

追従後、`pnpm run-local` が **`Error: spawn EBUSY`** で落ちるようになった。
`#164` と `#204` がビルドを Vite+（`vp`）に載せ替えた影響である。

切り分けた結果:

| 試したこと | 結果 |
|---|---|
| 単体の `vite build -c vite.app.config.ts` | **通る**（6〜19 秒） |
| `vp run --concurrency-limit 1` | 落ちる（並列は無関係） |
| 手で先にビルドしてから `vp run --cache` | 落ちる（キャッシュは 0% ヒット） |
| **`vp run --no-cache`** | **通る**（8.6 秒） |

**Vite+ のタスクキャッシュが有効なとき、esbuild のバイナリを spawn できない。**
WSL2 固有と思われるが、原因の層までは追っていない。

対処として `run-dev-server.js` の `--cache` を `--no-cache` に変えた
（フォークにコミット）。キャッシュを失うぶん起動は遅くなるが、
実測では **34 秒で Ready、暖機後 10〜15ms** と、むしろこれまでで最速だった。

#### 間引きは UI ビルドに効かない

途中で誤診し、二度訂正した。正しくはこうである。

**`vp run -r` は `wrangler.jsonc` の有無を見ない。** タスクを宣言している
パッケージを全部選ぶので、**我々が無効化した gatekeeper の UI もビルドされる**。
実際 `EBUSY` で落ちていたのは `gatekeeper-scheduler`——無効化済みのパッケージだった。

§2.6 の間引きは **Worker の起動には効くが、UI のビルドには効かない**。
起動時間とメモリのうち、後者への効果は限定的になった可能性がある。
（`#179 Speed up pnpm dev-server startup` がこの構造にした）

### 2.25 無料枠は UTC 日付では戻らない（2026-08-16）

**「daily」と書かれているが、UTC の日付境界ではリセットされない。**

エラー本文はこう述べる。

> AiError: **you have used up your daily free allocation of 10,000 neurons**,
> please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage.

実測はこうだった。

| 時刻（UTC） | 出来事 |
|---|---|
| 8/15 15:20〜15:26 | 大量消費（推定 17,193 neurons） |
| 8/15 15:48 | **429** |
| 8/16 07:22 | **まだ 429**。ゲートウェイのログ上、当日の消費は **0** |

16 時間経ち、UTC の日付も変わり、その日の消費がゼロでも通らない。
**移動 24 時間の窓**と推測しているが、待って確かめてはいない。

もう一つ、こちらの計測にも疑いがある。**neuron 換算は推定である**——
カタログの `$/1M トークン` と `$0.011/1,000 neurons` が線形に対応すると仮定して
逆算しているだけで、Cloudflare の実カウントと突き合わせていない。
「17,193」自体が過小評価の可能性がある。両方 §3 に置いた。

#### 実験の進み方に効く

この制約は小さくない。**編集 1 回が 5,000〜17,000 neurons** なので、
無料枠では**1 日 1〜2 回**しか試せない。しかもリセットが読めないと、
「明日やろう」の見積もりが立たない。

選択肢は三つある。

| | 内容 | 代償 |
|---|---|---|
| 待つ | 窓が抜けるのを待って再試行 | 実験の歩留まりが悪い。リセット時刻が読めない |
| **Workers Paid（月 $5）** | 10,000/日の無料枠は維持され、超過分が $0.011/1,000 neurons | 実費。ただし `kimi-k2.7-code` も解禁される（§2.20） |
| 小さくする | 試験用に短い `.nw` を用意し、消費を数分の一にする | 本物の文書での検証ではなくなる |

三つ目は**能力の確認には有効**である。`nw_tangle` を呼べるかどうかを見るのに
537 行の文書は要らない。**発見の検証**（文書を読んで気づくか）には本物が要るが、
**能力の検証**なら 20 行の玩具で足りる。

なお計測の訂正がひとつ。§2.23 で「入力 225,359 / 出力 8,457」と書いたのは
**実行中に API を叩いた取りこぼし**で、9 件しか拾えていなかった。
ダッシュボードの実数は 17 件（成功 13・エラー 4）、**入力 353,534 / 出力 9,470**。
費用 $0.19 は換算 17,273 neurons にあたり、§2.25 の推定 17,193 と概ね合う——
ただし**費用からの逆算どうしが一致しているだけ**で、Cloudflare の内部カウントを
見たわけではない（→ §3）。

### 2.26 治具 `gadgets/toy/toy.nw` を用意した（2026-08-16）

§2.25 の三つ目の選択肢を実行に移した。**68 行・3 チャンク**の Gadget を新規に書いた。

**チャンクを入れ子にしてある**のが設計の要点。`client.js` は本体を持たず、
`<<部品を作る>>` と `<<並べて動かす>>` を参照するだけにした。一段の平坦な文書だと、
エージェントが断片を渡してもそれらしい出力が出てしまう。参照を跨がせておけば、
**全文を渡さなければ落ちる**——道具に渡されたものが本物かどうかが結果の側から分かる。

これは確かめた。ルートチャンクだけを抜いた 4 行を `ntangle` に渡すと
`ntangle: undefined chunk <<部品を作る>>` で終了コード 255 になる。

`make` / `make check` / `mkgadget` / `ckgadget` すべて通り、`ckgadget -c` は
`.gadget` 内の 3 ファイルが原本と全一致すると報告した。**実機に載る状態**である。

まだ**動かしていない**。`toy.gadget` を workspace に読ませてボタンを押すところは
未実施なので、`nwitness` は「サーバ」「画面」の 2 節を未証のままにしてある。

### 2.27 無料枠は移動 24 時間で戻る（2026-08-17）

§2.25 の推測が当たった。**UTC 日付ではなく、使い切りからおよそ 24 時間**である。

| 時刻（JST） | 出来事 |
|---|---|
| 8/16 00:26 | 最後に成功した呼び出し。ここで枠を使い切る |
| 8/16 07:22 相当（UTC 8/16 の当日消費 0） | まだ 429。**日付境界では戻らない** |
| 8/16 16:22 | まだ 429（使い切りから 16 時間） |
| **8/17 00:52** | **200**。使い切りから **24 時間 26 分** |

確かめ方は Workers AI の REST を直接叩くだけでよい。Gateway を経由しないので
**枠の消費が最小**で済み、8 トークンで通るかどうかが分かる。

```sh
curl -s -w 'HTTP %{http_code}\n' \
  "https://api.cloudflare.com/client/v4/accounts/$ACCT/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"say ok"}],"max_tokens":8}'
```

**「およそ」を外せてはいない。**24h00m と 24h26m のどちらで戻ったのかは、
この一回では切り分けられない。窓が固定長なのか、消費のたびに個別に期限が切れる
ローリング集計なのかも未検証（→ §3）。実験の見積もりには
**「使い切ったら翌日の同時刻まで待つ」**で足りるので、それ以上は詰めない。

---

## 3. 未検証・推測にとどまること

**ここを既成事実として扱わないこと。**

| 項目 | 状態 |
|---|---|
| ~~`counter.nw` の tangle 出力が**実機で動くか**~~ | **検証済みに移動 → §2.8** |
| ~~`.nw` を 4 つ目のファイルとして Gadget に置けるか~~ | **検証済みに移動 → §2.9**。ただし「エージェントが `.nw` をどう扱うか」は API キーがないため未検証のまま |
| 連動が切れた機序 | 未確認。「コード変更 → Gadget 再起動 → RPC 切断」と推測しているが、再起動を直接観測してはいない。§2.9 の 3 点も `client.js` を読んで立てた仮説 |
| tangle をどこで走らせるか | **未決のまま、実害が出た**（§2.23）。エージェントは `.nw` を正しく直したが `client.js` を再生成できず、「更新した」と報告した。手段を与えるか、報告の形を変えるかの設計が要る |
| Source Map が Gadget のサンドボックスで機能するか | 未検証 |
| ~~`pnpm run-local` が動くか~~ | **検証済みに移動 → §2.6** |
| ~~`counter.gadget` のインポートが通るか~~ | **検証済みに移動 → §2.8** |
| ~~Blueprint から生成した Gadget が実際に動くか~~ | **検証済みに移動 → §2.8** |
| Gadget 画面の `Code` タブでファイルを追加・編集できるか | 未検証。手順4 はここを見るところから |
| ~~エージェントを動かすモデルの設定手順~~ | **検証済みに移動 → §2.20**。Workers AI で動いた。LLM プロバイダの鍵は使っていない |
| ~~Cloudflare AI Gateway の無料枠の範囲~~ | **調べた → §2.19**。あれは運営者が利用者に配る枠で、セルフホストは出す側だった。代わりに Workers AI の 1 日 10,000 neurons が使える |
| ~~Workers AI のモデルで `.nw` の編集がこなせるか~~ | **一部検証済み → §2.22**。`nemotron-3-120b` で一覧・読解・散文の追記まで到達した。**ただし tangle を要する編集は未検証** |
| ~~エージェントが tangle を理解しているか~~ | **検証済みに移動 → §2.23**。関係は理解している（正しいチャンクを選んだ）が、走らせる手段がない |
| ~~無料枠を超えたときに何が起きるか~~ | **検証済み（2026-08-15〜16、§2.25）**。しばらく猶予があり、その後 **429** で止まる。トークン 0 で課金なし。quick model も同時に弾かれる |
| ~~無料枠がいつ戻るか~~ | **検証済みに移動 → §2.27**。UTC 日付ではなく**およそ移動 24 時間の窓**。使い切りの 24h26m 後に通った |
| neuron 換算が正しいか | 未検証。`$0.011/1000` で線形と仮定した推定値であり、Cloudflare の実カウントとは違うかもしれない。ダッシュボードにも neurons は出ないので突き合わせようがない |
| 枠の窓が固定長かローリング集計か | 未検証。24 時間で戻ることは確かめたが（§2.27）、窓が一括で開くのか消費ごとに個別に期限切れするのかは分けられていない |
| `gatekeeper-context` を外すと core が壊れるか | 未検証。壊れる恐れがあるので残している |
| 間引きを戻して watcher 15 個を立てられるか | 未検証。§2.13 の環境なら乗る計算だが試していない。**メモリの厳しい環境での検証もしたいので、間引きは維持する** |
| ~~`getActionResult` で結果を回収する往復~~ | **検証済みに移動 → §2.18**。承認前・承認後・却下後の三通りを観察した |
| ~~却下（`Deny`）したときの経路~~ | **検証済みに移動 → §2.18**。却下した呼び出しは接続先に一度も届かない |
| ~~嘘の `readOnlyHint` が素通りするか~~ | **検証済みに移動 → §2.17**。素通りする。ただし試したのは利用者が繋いだ接続先の層で、管理者が保証する `vetted` 層は未検証のまま |
| 有澤誠訳での tangle / weave の訳語 | 不明。原本未確認 |

`tangle` の実行場所については選択肢が 2 つある。

1. エージェントが保存時に走らせる（外付け。素直だが規律に依存する）
2. **Gadget 自身が自分を tangle する**（自己言及的。Knuth 好み）

---

## 4. 成果物

このリポジトリに同梱。パスは §4 の表のとおり。

| ファイル | 内容 |
|---|---|
| `ntangle` | Perl 製の最小 tangler（40 行）。`-r <チャンク名>` でルートを選ぶ |
| `nweave` | Perl 製の最小 weaver（.nw → HTML）。証拠を種類別に色分けする |
| `nwitness` | **証拠を集計する第三の道具**（§6.1）。既定は未証の節だけ、`-a` で全部、`-v` で裏取り。`.md` を渡すと本文中の引用を突き合わせる |
| `mkgadget.mjs` | `.gadget` Blueprint を組み立てる（Node）。実機へ載せる経路。詳細は §2.7 |
| `ckgadget.mjs` | `.gadget` を解いて検証する。`mkgadget` の対。純正の `.gadget` も解ける |
| `mockportal.mjs` | 手順2 用のモック MCP ポータル（Node、依存なし）。承認フローを外部アカウントなしで観察する。詳細は §2.14 |
| `counter.nw` | 共有カウンタ Gadget の文芸的原本 ★中心的な成果物 |
| `notes.nw` | 承認を観察する Gadget の文芸的原本。Gadget と Gatekeeper のあいだを見る（§2.14） |
| `server.js` / `client.js` | `counter.nw` の tangle 出力 |
| `counter.html` | `counter.nw` の weave 出力 |
| `counter.gadget` | 実機へ持ち込む Blueprint。`server.js` / `client.js` を同梱したバイナリ |
| `literate-programming-primer.md` | noweb / CWEB の最小入門（Lisp・Perl 話者向け） |
| `demo.nw` / `demo.pl` / `demo.html` | 入門用の小例 |
| `sieve.w` / `sieve.c` | CWEB の例と `#line` を含む tangle 出力 |
| `primes.web` / `primes.pdf` | オリジナル WEB（Pascal）の例と組版結果 |

### `ntangle` の使い方

このリポジトリでは `make` が全部やる。手で叩くなら:

```sh
./tools/ntangle -r server.js gadgets/counter/counter.nw > gadgets/counter/server.js
./tools/ntangle -r client.js gadgets/counter/counter.nw > gadgets/counter/client.js
./tools/nweave              gadgets/counter/counter.nw > gadgets/counter/counter.html
```

チャンク定義は `<<名前>>=` で始まり `@` だけの行で終わる。
参照は `<<名前>>`。同名の再定義は**追記**になる。

---

## 5. 次にやること（推奨順）

### 手順 1: 実機で動かす — **完了（2026-08-07）**

結果と、そこで踏んだ地雷は §2.6 にまとめた。**先にそちらを読むこと。**
特にメモリ不足対策（gatekeeper の間引き）を飛ばすと OOM で落ちる。
別のマシンでの再現手順（pnpm の用意を含む）は §2.13。

```sh
cd reference/cloudflare-os
pnpm run-local          # → http://localhost:8787
```

`packageManager` は pnpm 11.17.0 が指定されている。

### 手順 2: 承認 UI を実際に見る — **完了（2026-08-10）**

結果は §2.14。三つの観察項目はすべて見た。

当初は「副作用のある操作をエージェントにさせる」想定だったが、
**エージェントも API キーも要らなかった**。Gadget が binding を叩けば
pending が立つ。接続先も自作の MCP サーバ（`tools/mockportal.mjs`）で足り、
外部アカウントは要らない。

再現するには `gatekeeper-mcp-portal` を有効化し、`.dev.vars` に
`MCP_ALLOW_INSECURE` と `MCP_PORTAL_*` を置いて、モックサーバを起動する。
詳細は §2.14。

- ~~pending の action がどう表示されるか~~ → 見た
- ~~自動承認ルールを後から追加したとき、pending がその場で適用される様子~~
  → 見た。**ただし前に人手の関門があると適用されない**（§2.4 を訂正した）
- ~~`actionKind` を持たない action が「常に手動」として区別されているか~~
  → MCP は必ずタグを付けるので、この形では試せなかった。代わりに
  **タグはあるが `autoApprovable` が false** という別の「常に手動」を観察した

### 手順 3: `counter.nw` を実機に載せる — **完了（2026-08-07）**

結果は §2.8。当初は「エージェントに Gadget を作らせて貼る」想定だったが、
それには API キーが要る。**Blueprint インポートなら鍵なしで載せられた**ので、
順序を入れ替えてある（旧・手順5 が手順3 の前提になった）。詳細は §2.7。

手順を再現するには:

```sh
make                        # .nw から server.js / client.js を作り直す
node tools/mkgadget.mjs -o gadgets/counter/counter.gadget \
    -t "Literate Counter" gadgets/counter/server.js gadgets/counter/client.js
```

`http://localhost:8787` の **Blueprints** 画面からこのファイルをインポートし、
Blueprint から Gadget を生成して、**2 つのタブで開きカウンタが同期するか**を見る。
**ここで初めて §2.5 が検証される。**

Windows のファイル選択ダイアログからのパス:

```
\\wsl.localhost\Ubuntu\home\tokuhira\dev\literate-gadget\gadgets\counter\counter.gadget
```

弾かれた場合の切り分け。前 3 つは往復検証で潰してあるので、出るとすれば 4 番目——
つまり**そこから先は文芸的プログラミング側の問題**であり、それが本来検証したいこと。

| メッセージ | 意味 |
|---|---|
| `Invalid gadget archive magic number` | プレフィックスの組み立てが違う |
| `Unsupported gadget archive version` | 形式版の不一致 |
| `metadata is not valid JSON` | メタデータの生成が壊れている |
| 上記以外／インポート後に動かない | 形式は通っている。`counter.nw` のコード側の問題 |

### 手順 4: `.nw` を 4 つ目のファイルとして置いてみる — **完了（2026-08-12）**

A（一覧）・B（読解）・C（編集）すべて実機で見た。結果は §2.22 と §2.23。

| | 結果 |
|---|---|
| **A** 一覧 | `.nw` を認識。ファイル一覧はシステムプロンプトで渡されるので**未知の拡張子でも見落とされない** |
| **B** 読解 | 533 行を 3,332 文字で正確に要約。ただし**チャンク記法にも `@証` にも言及しなかった** |
| **C** 編集 | **`.nw` を原本として扱った**。正しいチャンクの正しい位置に書いた。だが **`client.js` を再生成できない** |

**予期していた反証は起きなかった。** エージェントは一度も
「`.nw` を放置して `server.js` を直接いじる」をしていない。

**代わりに別の壁が出た。** tangle を走らせる手段がないので、
文書は正しくなるが**アプリは変わらない**。しかも報告は
「`client.js` を更新した」と述べる（§2.23）。残り半分は人間が `make` で回した。

#### ここから派生した論点

- **tangle をどこで走らせるか**（§3、未決）。実害が出たので設計が要る。
  エージェントに道具を与えるか、報告の形を変えるか
- **費用が文書の長さに比例する**。537 行の `.nw` で編集 1 回が
  1 日の無料枠を超えた（§2.23）。§6.3 の「追記を差分の単位にする」と
  正面からぶつかる
- **エージェントの出力は「コードとして正しく、文書として半分」**。
  散文を書かないので、`.nw` の作法は人間が補っている

### 手順 5: Blueprint 化してエクスポート

`.gadget` として書き出し、§2.2 の構造どおりに `.nw` が含まれているか
バイナリを解いて確認する（Python + `yjs` npm パッケージで読める）。

---

## 6. 未解決の設計論点

### 6.1 witness（第三の出力）

WEB が記述するのは**構造**だけで、**振る舞い**は書けない。
一方 Gatekeeper は外部への全アクションを記録し、
副作用のある操作はシミュレートしてキューに積む。

このログを weave 出力に織り込むと、
「何をするつもりか」だけでなく「**実際に何をしたか**」を含む文書になる。
`tangle` / `weave` に対する第三の操作として `witness` と仮称している。

さらに踏み込むと、**承認 UI そのものを weave 出力にできる**。
コード・意図の散文・保留中の副作用とそのシミュレート結果が一枚の文書に統合され、
人間はそれを読んで承認する。

日本語の訳語案: 綯う（tangle）/ 織る（weave）/ 証す（witness）。

#### §2.10 で具体化したこと

当初この構想は Gatekeeper のログを念頭に置いていたが、**もっと手前に用途がある**
ことが分かった。§2.10 の時点で `counter.nw` の記述はこう混在していた。

| 記述 | 判定 | 判定の根拠 |
|---|---|---|
| 「メモリに置いた値は再起動で消える」 | 正しい | 実機で確認 |
| 「関数そのものを RPC で渡せる」 | 正しい | 動作した |
| 「コードを書き換えるとサーバは再起動し、接続が切れる」 | 正しい | 観察された |
| 「少し待ってから何度か試す」 | **誤り** | 例外が出ないので試行すらされない |

**読んだだけでは 4 番目だけが誤りだと見分けられない。** 全部が同じ調子で
書かれているからである。ここに `witness` の最小の用途がある。Gatekeeper の
承認ログのような大掛かりなものでなくてよく、
**「この記述は実機で確かめた／確かめていない」の印が付くだけで価値がある。**

#### 試作した（2026-08-07）

`tools/nwitness` として最小実装がある。記法はこう。

```
@証 <種類> <典拠> <記述>

@証 物証 2026-08-07 二つのウィンドウで連動を確認した
@証 証言 agent.ts:534 calls made while its replacement is being acquired will wait
@証 推理 GadgetUI.tsx:355-365 gadget は親フレームの Proxy で、保留中は待つ
```

種類は **物証 / 証言 / 推理** の 3 つ。2 値では足りないことは §2.10 で分かった
——`agent.ts:534` という**証言は正しかったのに、適用範囲を取り違えて結論が狂った**。
証言と物証は違う。

設計上の判断:

- **平文の既定は「未証」。** 証拠を足す方向にしか働かないので既存文書を壊さない。
  緩く使うなら `nwitness` を走らせなければよく、走らせれば未証の節が TODO になる
- **粒度は節（`##`）単位。** 文単位だと平文のほぼ全部が並んで使い物にならない
- **`ntangle` は変更不要だった。** 終端判定が `/^\@\s*$/` なので `@証` と衝突せず、
  平文はもともと捨てられる。noweb の構造がそのまま証拠の置き場になっている

使ってみて見えた弱点（未解決）:

1. **証拠は節に付くが、主張は文に付く。** 同じ節の裏付けのない文まで
   証拠付きに見えてしまう
2. **物証にも解釈が混じる。** 「固まりエラーも出なかった」は観察だが、
   「だからハングだ」は解釈。記法上は区別できていない
3. ~~**証拠が古びる。**~~ → **裏取りを実装した（2026-08-09、下記）**
4. **守れるのは `.nw` だけ。** `nwitness` は `.nw` を読む道具なので、
   同じ引用が `HANDOFF.md` にあっても検査されない。**事実の大半はこちらに
   あるのに無防備である。** 2026-08-10 に上流の 1 コミットで手書き引用が
   3 件同時に腐り、機械は何も言わなかった（§2.15）

1 と 2 は実際に使って困ってから直すほうがよい。
4 は実害が出たので**その日のうちに直した**（下記）。

#### 全節を監査した（2026-08-09）

`counter.nw` の未証 8 節を埋めた。結果は **12 節中 未証 1**、
証拠は 物証 7 / 証言 11 / 推理 3。`make witness` で確認できる
（`ALL=1` で証拠付きの節も出る）。

**証拠を付ける作業そのものが監査になった**のが最大の収穫。
「ここに何の証拠が置けるか」を考えると、置けないことに気づく。
以下は `nwitness` が未証と表示しなければ素通りしていた。

- **断定していたが未証だった記述。** 「`[Symbol.dispose]` は接続が切れたときに
  呼ばれる」。§2.10 の実験では確かめようがなかった（発火して `connect()` が
  ハングしたのか、そもそも発火しなかったのか、症状が同じ）。一次資料を当たると
  公式の例に同じ記述があり、証言で裏付けられた。**誤りではなく根拠がなかっただけ**
- **公式例との差異。** 公式は `gadget.subscribe(this)` と同じオブジェクトを
  渡し直すが、こちらは `new Watcher()` を作り直している。
  **どちらが正しいかは未検証**。証拠を付けようとして初めて気づいた
- **落とせなかった 1 節。** 「配信」の `catch` が働くところを観察できていない。
  切れた接続は `onRpcBroken` が取り除くので、`update` が失敗するのは
  「切断から除去までの隙間」に限られる。狙って観察する方法がまだない。
  握り潰す判断は妥当だと思うが**推測であって事実ではない**と文書に明記した

#### `nweave` を直した（2026-08-09）

証拠だけが整形されて地の文が生の Markdown という状態だったので、
最小限の記法（見出し・強調・インラインコード・区切り線）を解釈するようにした。

ついでに**実在の不具合が直った**。平文の `<` を一切エスケープしていなかったため、
「その二つが `` `<<...>>` `` の記法で」という一文の `<<...>>` が
**ブラウザに飲まれて消えていた**。エスケープを先に、マークアップを後にする順序にした。

`ntangle` は引き続き変更なし。生成コードは `@証` 追加の前後で 1 バイトも動かない。

#### 証言の裏取りを実装した（2026-08-09）

弱点 3 への対処。`make witness VERIFY=1`（`nwitness -v`）で、
**引用が本当にその行にあるか**を参照元と突き合わせる。

種類ごとに検査できることが違うので、扱いを分けた。

| 種類 | 典拠 | 検査すること |
|---|---|---|
| `証言` | `agent.ts:470` | **引用文がその行に実在するか** |
| `推理` | `GadgetUI.tsx:355-365` | 本文はこちらの推論なので、**行が実在するか**だけ |
| `物証` | `2026-08-07` | 日付。突き合わせる相手がない |

突き合わせ前に正規化する。バックスラッシュとバッククォートを落とし、
空白を潰す。出典側は TS のテンプレートリテラル内で `` \` `` と書かれ、
こちらは Markdown の記法として書くため、そのままでは一致しない。
どちらも飾りなので中身だけを比べる。

参照元は名前で引く（`agent.ts` → `packages/workshop-backend/src/agent.ts`）。
`node_modules` / `dist` / `generated` は索引から除く。同名が複数あれば
曖昧として報告する。`reference/` がないときは `-v` を付けても走らない。

**導入した時点で本物の誤りを 1 件捕まえた。** `agent.ts:526` の証言が
逐語引用ではなくこちらの要約になっていた（「公式の例にも … と注記されている」）。
`証言` と名乗りながら引用でないものを、道具が咎めた。

もう 1 件は偽陽性で、バッククォートの扱いの差だった。**この 2 つを
区別できたことが収穫。** 記法の揺れは道具側で吸収し、雑な引用は文書側を直す。

行番号を意図的にずらして反応も確かめた。1 行のずれも範囲外も検出し、
問題があれば終了コード 1 を返す。

**裏取りできるのは所在であって妥当性ではない。** 実際この直後、
「購読者の除去は `onRpcBroken` の経路のみ」という推理に `GadgetUI.tsx:186-190`
という無関係な典拠を付けてしまった。行は実在するので `-v` は通る。
除去はこちらの `server.js` の話で参照元とは関係がなく、人間が気づいて消した。
**関連性は機械では見られない。**

#### 「配信」の catch を観測した — 未証 0 に到達（2026-08-09）

最後まで残った未証を落とした。§6.1 の弱点ではなく、単に観察方法が
思いつかなかった節である。

**手口。** 本番では `onRpcBroken` が切れた購読者を取り除くので、
`update` が失敗するのは「切断から除去までの隙間」に限られ、狙って
当てられない。そこで**隙間を無限に広げた**——`onRpcBroken` を付けない
実験用 Gadget を作り、切れた購読者が集合に残り続けるようにした。
失敗回数を Durable Object ストレージに数えて画面に出す。

`setTimeout` で遅らせる案もあったが、Durable Object で使える保証がないため
除去そのものを外す方を採った。実験用の `.gadget` は `mkgadget` で組み、
`ckgadget` で往復検証してからインポートした。

**結果。** ウィンドウを 2 つ開き（購読者 2）、片方を閉じても購読者は 2 のまま。
残った側で 3 回押すと、カウンタ 1→4 に対し配信失敗 0→3。
死んだ購読者 1 個につき配信ごとにちょうど 1 回である。初回だけ表示に
遅れがあり、以降は人の目には同時に見えた（遅れの理由は未確認）。

**言えること・言えないこと。** `catch` は到達可能で、失敗を握り潰す。
到達不能な死んだコードではない。**しかし本番の隙間で発火するところは
見ていない。** 条件を作れば発火する、までである。文書にもそう書いた。

**手順書の誤り。** 「2 つのウィンドウで開く」とだけ指示したが、Blueprint から
生成するたびに**別のワークスペース＝別の Durable Object** ができる。
最初の試行では 2 つの別ワークスペースを開いてしまい、購読者が 1 ずつに
なった。状態を共有するには**同じワークスペース URL** を 2 窓で開く必要がある。

#### Markdown の引用も見るようにした（2026-08-10）

弱点 4 への対処。**風化が実際に起きたのが `.nw` ではなくこの HANDOFF だった**ので、
守備範囲を揃えた。`nwitness HANDOFF.md` で、本文に散らばった
バッククォート囲みの「ファイル名:行番号」を拾って突き合わせる。
`make witness VERIFY=1` に含めてある。

`.nw` と違って地の文には「種類・典拠・記述」の構造がない。あるのは引用と、
その隣に書かれていることの多い短い逐語だけである。これを**アンカー**と呼び、
`.nw` の二段構えをそのまま持ち込んだ。

| | 検査すること | `.nw` での対応 |
|---|---|---|
| アンカーあり | 逐語がその範囲に実在するか | `証言` |
| アンカーなし | 行が実在するかだけ | `推理` |

**行の存在だけでは今回の風化は捕まらない。** ずれた先にも行はあったからである。
だからアンカーのない引用は未証と同じ扱いで並べ、足す先を示す。
アンカーは既に本文で使っていた 3 つの書き方から自動で拾う。

```
`mcp.ts:77` — `const TRUST: ServerTrust = "byo";`     ← 破線のあとのコード
`api.ts:1595-1598` に「Interface to … code sync」     ← 「」の引用
"Eligibility requires BOTH signals"（`auto-approval.ts:58`）  ← 引用が先、典拠が後
```

**本命の検証**: 今日腐った 3 件を腐る前の値に戻して走らせたところ、
**3 件とも検出した**。行番号を 1 つずらす／範囲外にする試験も反応し、
問題があれば終了コード 1 を返す。

導入時に文書側の誤りも 2 件見つかった。どちらも
**「引用」と名乗りながら逐語でなかった**もので、
`importBlueprint(file.stream())` と `newGadgetFromBlueprint()` は
実際には引数が違う。2026-08-09 に `agent.ts:526` で捕まえたのと同じ類である。
**道具を入れるたびに同じ種類の嘘が出てくる。**

道具側の誤検出も 2 件あり、こちらは道具を直した。

- **複数行に跨る引用が `//` で切れる。** 行頭のコメント記号を落としてから
  連結するようにした（`hay_of`）。飾りであって中身ではない
- **次の行にある別の典拠の引用文を掴む。** 引用符の開きは典拠と同じ行に
  なければならない、という条件を足した

**記法の揺れは道具側で吸収し、雑な引用は文書側を直す**という 2026-08-09 の
判断が、そのまま二度目にも当てはまった。

現状は 引用 26 件、うちアンカーあり 15、要確認 0。残りは `GadgetUI.tsx` への
推論（`.nw` でも `推理` 扱い）と、道具自身の説明に出てくる例示である。
**アンカーなしは不良ではなく、証拠の強さが一段低いことの表示**である。

#### 探偵という比喩について

この語彙は「文芸的探偵手法」という思いつきから来ている。捜査の手続き
——聞き込み・物証・状況証拠・アリバイ・推理・カマをかける・自白——が、
見えない部分の多いシステムを相手にする作業とよく対応する。実際 §2.10 の調査は
「わざと事件を起こして反応を見る」「システム自身の供述を探す」の連続だった。

`literate` → `文芸的` が**成果物の性質**に名を与えたのに対し、これは
**調べ方**に名を与える。層が違うので競合しない。

**ただし罠がある。探偵小説は「犯人が存在し、一人である」ことを前提とする。**
§2.10 のハングに寄与した要因は少なくとも 3 つあり、実際に §2.9 で
一つだけ見て断定し、無実の `counter.nw` に「修正」を施した。比喩を使うなら
**共犯**や**複数要因の事故**まで語彙に入れないと、捜査を早く打ち切る。

参考にした発想の出所: 京都芸術大学の記事（美術史研究とホームズの方法論の比較）。
プログラミングの話ではないが、**逆推理**——現在残る証拠から過去を推論する——と、
**「これ以外の仮説ではどうしても事実と符合しない」まで検証を重ねる**という基準が
そのまま使える。§2.10 で誤った散文を書いたとき、この基準を満たしていなかった。

##### ホームズより倒叙（コロンボ）が近い

ホームズは「誰が」を当てる。コロンボはほとんどの回が**倒叙**で、
冒頭に犯行が映り、視聴者は犯人を知っている。謎は「**どう立証するか**」である。

**こちらの作業は倒叙のほうだ。** `GadgetUI.tsx` は最初からそこにあり誰でも読める。
難しいのは犯人を当てることではなく、**どの読みが正しいと示すか**。
ソースが公開されているシステムを相手にする作業は本質的にこの形になる。

実際に効いた手も倒叙的だった。

- **小さな引っかかり。** §2.10 を割ったのは「連動だけでなく**ボタンも不動**」という
  一言。同期だけが止まったなら犯人は購読処理だと考えて終わっていた
- **「もう一つだけ」。** §2.9 で断定して立ち去ったのが誤りだった。
  `nwitness` が未証の節を並べるのは、要するに**帰りかけて振り返る仕掛け**
- **容疑者は流暢に説明しすぎる。** コロンボの犯人はたいてい聡明で弁が立つ。
  §2.10 でその役を演じたのは**エージェントの書いた散文**だった

##### 証明支援系との違い

Coq のような証明支援系は、**静的な命題をカーネルが true/false へ還元する**。
こちらが相手にしているのはそうではない。

- 命題が**動く**。上流が更新されれば「証言」の中身が変わる（弱点 3）
- 証拠に**強さの序列はあるが、どれも決定的ではない**。
  物証ですら「観察」であって「解釈」ではない（弱点 2）
- **反証が来るまで暫定的**。実際 §2.10 で一度ひっくり返った

法廷の比喩が向くのは、**判断を確定させずに扱う枠組み**だからだと思われる。
有罪・無罪を出すのではなく「この証拠でどこまで言えるか」を記録する。
カーネルを持たない代わりに、**証拠の出所と種類を残して後から再審できるようにする**。
動的に相互作用する土台には、この形のほうが合う。

### 6.2 散文の信頼性

エージェントが書いた散文は流暢だが誤りうる。
これは文芸的プログラミングの古典的失敗（散文とコードの乖離）の
AI 版であり、しかも「エージェントが再生成できるから解決」とはならない。
再生成される散文自体が捏造されうるからである。

**部分的な解**: 散文に証拠を持たせる。
「このチャンクはこう動くはずだ」ではなく
「このチャンクをこう呼んだらこう返った」を文書に埋める。
Gatekeeper のログ、テストの実行結果、tangle が通った事実。

#### 実際に起きたこと（§2.10）— 想定より悪い

この節は当初「散文とコードが乖離する」ことを警戒していた。**実際に起きたのは
それより悪い。散文が間違っていたから、コードも間違った。**

再接続処理を書いたとき、まず「失敗したら少し待って何度か試す」という散文を書き、
それに合わせて `try`/`catch` とリトライを実装した。ところが `gadget` への呼び出しは
失敗時に例外を投げず**待ち続ける**ため、`catch` は一度も走らなかった。
**文書とコードは食い違っていない。仲良く揃って間違っていた。**

このため、次のどれもが誤りを検出できなかった。

- `ntangle`（tangle は通る）
- `node --check`（構文は正しい）
- 文書とコードの突き合わせ（一致している）
- 人間が文書を読むこと（もっともらしい）

**実行だけが検出した。** しかも実行しても症状は「何も起きない」で、
エラーメッセージすら出なかった。

散文が一次でコードが二次という構成（§1「tangle / weave の向きの逆転」）を
採る以上、**誤った散文は誤ったコードを生む経路を持つ**。これは
「嘘の置き場所が増える」より強い主張であり、`witness`（§6.1）が
あれば良いという程度の話ではなく、**なければ危険**という水準の問題になる。

#### 別の壊れ方があった — コードに至らない劣化（2026-08-12）

§2.22 の C で、エージェントに「節を足して」と頼んだ。**節は足された。
そして頼んでいない既存の一文が、静かに書き換わっていた。**

```
- 前に関門があれば適用されない。**説明のほうが実装より大雑把だった。**
+ 前に関門があれば適用されない。**説明のほうが実備より大雑把だった。**
```

`実装` が **`実備`** になっている。**日本語として存在しない語**である。
差分の見出しは `-1 +12`——11 行の追加に、書き換えが 1 行紛れていた。
実機の doc を取り出して確認済みで、`説明のほうが実装より大雑把` は
消え、`実備` の側だけが残っていた。

#### 我々の装置は一つも捕まえなかった

| 検査 | 結果 |
|---|---|
| `ntangle` | 通る。散文なのでコードに影響しない |
| `node --check` | 通る |
| `make witness VERIFY=1` | 通る。引用の行番号は無傷 |
| **`.nw` の diff と `.js` の diff を並べる**（`CLAUDE.md` の方針） | **`.js` に差分が出ないので、並べる意味がない** |
| 人間が diff を読む | **これだけが捕まえた** |

最後から二つ目が重い。生成物を git に入れているのは
「一つの変更に対して `.nw` の diff と `.js` の diff が並んで見える」ためだが、
**散文だけの劣化は `.js` 側に何も残さない**。装置の想定外である。

#### §6.2 の主張が一段広がる

これまでの §6.2 は「**誤った散文が誤ったコードを生む**」だった。
§2.10 の実例がそうで、嘘の散文がそのまま no-op のコードになった。

今回は違う。**コードには何も起きない。散文だけが静かに劣化する。**

- §2.10 型: 散文の誤り → コードの誤り。**実行すれば分かる**（分かるまでが遠いが）
- 今回の型: 散文の誤り → **どこにも波及しない**。だから**何をやっても分からない**

**波及しないことが、検出できないことを意味する。**これは
「実行だけが検出した」という §2.10 の教訓が効かない領域である。

しかも壊れたのは**検証済みと明記した節**だった。§2.14 で実機観測して
物証を付けた記述が、「別の節を足して」という依頼の巻き添えで劣化した。
**証拠を付けた事実が、証拠と無関係な経路で壊れる。**

#### `witness` に何ができて、何ができないか

`nwitness` は**引用が指す先**を守る。上流が動けば捕まえる（§2.16、§2.22）。
だが**引用していない地の文**は守らない。今回壊れたのは地の文である。

原理的に、地の文の劣化を機械が捕まえるには「以前の版」と比べるしかない。
それは git がやっていることであり、**道具ではなく人間が diff を読む工程**の話になる。
`nwitness` を拡張して解ける問題ではない。

**したがって当面の対処は工程側にある。** エージェントに `.nw` を編集させたら、
**差分を人間が読むまで確定させない**。§2.22 で見た `Pending changes` /
`Accept changes` は、まさにその工程を強制する仕掛けとして機能する。
承認 UI が副作用に対してやっていること（§2.14）を、**文書の変更に対しても
やる**必要がある、という話になる。

### 6.3 追記機能を差分の単位にする

同名チャンクへの追記は、エージェントが機能を追加するときの
自然な操作単位になりうる。既存コードを書き換えるのではなく、
**新しい節を文書末尾に足し、既存チャンクに追記する**。
差分が「文書に一節加わった」という形で人間に見える。
通常の diff より読みやすいはずで、
「コードを読まずに変更内容を理解する」という目標に直結する。

#### 実際に追記させた（2026-08-12）— 形は綺麗、中身は重複

§2.22 の C で、エージェントに「『却下の経路』という節を足して」と頼んだ。
**操作としては期待どおりだった。** 新しい節が文書に加わり、差分は `-1 +12`。
人間の目に「一節加わった」と見える。仮説の前半は成立している。

**だが中身は既存の記述とほぼ完全に重複していた。**

| エージェントが書いたこと | 既に書いてあった場所 |
|---|---|
| 却下は「実行しない」、一切転送しない | 「観察した結果」 |
| 接続先には何も届かない | 同上 |
| 解決者の名前は記録される | 同上 |
| `rejected` と `was not approved.` | 「回収」の表 |

**新しい情報は一つもなかった。** 節を足すという操作は正しく行われ、文章も読みやすい。
しかし**既に書いてあることを知らずに（あるいは確認せずに）書き直した**。

**読みやすい差分であることと、意味のある差分であることは別である。**
§6.3 が期待していたのは後者だが、得られたのは前者だけだった。
しかも同じ依頼の巻き添えで既存の一文を壊している（§6.2）。
**足したものは重複、壊したものは検証済みの記述**という収支になる。

#### 取り込みは「節ごと」ではなく「一文だけ」にした

査読して、**唯一新しかった切り口だけを既存の節に足した**——
「承認履歴には残るが、接続先のログには何も残らない」という
**二つの記録の非対称**である。届いていないのだから当然だが、裏を返すと
**接続先の側からは却下があったことが見えない**。三方向のうち一方だけが
知っている事実がある、という話になる。

節は作らなかった。**文芸的プログラミングは散文が増えやすいので、
削る規律がないと膨らむ一方になる。**

#### 含意

**追記を差分の単位にする構想は、操作の単位としては機能する。**
エージェントは `.nw` を原本として扱い、節を足すという形で変更を表現した。

**しかし単位が自然であることは、内容の質を保証しない。**
「一節加わった」という読みやすい形のまま、重複や劣化が入ってくる。
§6.2 の結論——**差分を人間が読むまで確定させない**——がここでも要る。
`Pending changes` / `Accept changes`（§2.22）はその工程を強制する仕掛けであり、
承認 UI が副作用に対してやっていることと同じ形をしている。

### 6.4 チャンクの順序自由をどこまで許すか

Knuth の `tangle` の核心は提示順序と実行順序の分離だが、
自由にするほど tangle 後の行番号対応が複雑になる。
`#line` / Source Map で解けるはずだが、
Gadget のサンドボックスで機能するかは未検証（§3）。

### 6.5 参照元の版をどう固定するか（2026-08-11 の判断）

**証拠は参照元の版に依存するのに、その版が記録されていない。**
過去の literate-gadget をチェックアウトしても、`setup.sh` はフォークの
**tip** を持ってくる。8/10 の `notes.nw` は `run-dev-server.js:192` を
指していて当時は正しかったが、いまの reference では 203 である。
**「風化していなかった時点」を再現できない。**

§6.1 の弱点 3（証拠の風化）は、**検出はできるようになったが再現はできない**という
半分の状態にある。

#### submodule が素直な答えだが、いまは採らない

git submodule は親のツリーに SHA を記録するので、この用途そのものである。
このプロジェクトの流儀とも合う——規律に頼らず道具に検出させる、というのが
`nwitness` を書いた判断だった。pin ファイルを自作して `setup.sh` に読ませるより、
**git 自身が保証する**ほうが筋が通る。

**採らない理由は一つ。フォークを rebase して force-push しているからである。**
submodule の pin は SHA を指すが、次の同期でその SHA はどのブランチからも
到達不能になる。**pin が腐る。**

rebase は捨てられない。`git diff main..literate-gadget-minimal` が
「リネームのみ、0 insertions」で読めることは、同期のたびに確認している
実際に使っている性質である（§2.12、§2.16、§2.20）。merge に変えると濁る。

#### 代わりにタグを push することにした

**タグさえ押しておけば、rebase で捨てた版も恒久的に取り出せる。**
`before-sync-<日付>` は元々ローカルで作っていたので、push を手順に足すだけで済む
（§2.12 に反映済み）。2026-08-11 に既存の 2 つを遡って push した。

| | submodule | タグを push |
|---|---|---|
| 版の記録 | 親のコミットが SHA を持つ | 手順書とタグ名 |
| 検査 | git が保証 | 人間の規律 |
| rebase との相性 | **悪い**（pin が腐る） | 良い |
| 手数 | 毎回 2 段のコミット | 同期のとき 1 行 |
| 構成変更 | `.gitignore` / `setup.sh` / `CLAUDE.md` / 手順書 | 手順書のみ |

**タグは submodule の下位互換ではなく、前提条件である。**
submodule を後から入れるとしても、到達可能性はタグが担保する。
だから今日やったことは、将来の選択肢を狭めない。

#### いつ見直すか

**本腰で運用（本家 Cloudflare へのデプロイ）に移るとき**に、DevSecOps の観点から
まとめて設計し直す。そのとき submodule 化、`.dev.vars` に平文で置いている
資格情報の扱い、公開範囲などが同時に論点になる。それまではこのままでよい。

---

## 7. 注意点

- **Cloudflare のコードをそのまま引用・改変配布しない。** 調査は読むだけに留め、
  試作は新規に書くこと。`counter.nw` はその方針で書いてある
- リポジトリは「大きな外部 PR は受け付けない」方針を明記している。
  上流への貢献ではなく、fork / Blueprint レベルの実験として進める
- `.gadget` のインポートには上限がある（メタデータ 64 KiB、本体 32 MiB）
- Gadget のコードは実行時にネットワークへ出られない。
  tangle をランタイムで走らせるなら、tangler は Gadget 内に同梱する必要がある

---

## 8. 背景（任意）

この企画は、Knuth の TeX プロジェクトと TAOCP の関係を辿る会話から派生した。
関連する事実で、判断材料になりうるもの:

- WEB / 文芸的プログラミングは TeX 開発（1977–1990）の副産物であり、
  Knuth 自身は TAOCP 本文では文芸的プログラミングを使っていない。
  使っているのは付属ソフトウェア（MMIXware、Stanford GraphBase、
  第 4B 巻の SAT ソルバ群）のほう
- 日本語圏の先行例: 増井俊之の `wtangle`（TeX を捨てて HTML を文書形式にした Perl 実装）、
  `mcweave`（tangle を廃してソースが直接コンパイル可能なままにした C 向け実装）。
  いずれも「通常の開発には重すぎるが、解説には向く」という結論に達している
- **順序自由（`<<...>>=` による再配置）を継承した日本語ツールは見当たらない。**
  Org-babel や Jupyter はこの核心部分を落としている
