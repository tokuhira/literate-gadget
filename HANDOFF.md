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
- `resolvedBy` に解決者が残る。自動承認の場合は**ルールを有効にした人**が記録される
- ルールを後から追加すると、一致する pending の action がその場で適用される
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

なお clone は `--depth 1` の shallow なので、**上流追従の際は先に
`git fetch --unshallow upstream` が要る**（未実施・未検証）。

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
- キーを使う場合の設定先はリポジトリルートの `.dev.vars`（`KEY=VALUE`、gitignore 済み）。
  `run-dev-server.js` の `loadDevVars()` が起動時に読む。Cloudflare AI Gateway 経由の
  `CF_AI_GATEWAY*` という選択肢もある（`docs/public-server.md`、無料枠の存在が示唆
  されているが**未検証**）。

#### Blueprint インポートという迂回路（コードで確認）

UI に**エージェントを通さない経路**がある。

| 経路 | 場所 |
|---|---|
| `.gadget` のインポート | `BlueprintList.tsx:195` — `importBlueprint(file.stream())` |
| Blueprint から Gadget 生成 | `BlueprintLandingPage.tsx:578` — `newGadgetFromBlueprint()` |
| 画面 | `routes/blueprints.tsx`、`routes/blueprint.$id.tsx` |

なお `Overseer.createGadget(title, chatId?, bindingName?)` は **`chatId` を省略すると
恒久的に作成される**（`api.ts:1340-1349`）。`bindingName` 省略時の自動命名は
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
- **明示的な「保存」操作はない。** 編集が随時反映される（コードは Yjs の共有 doc なので
  当然ではある）
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

---

## 3. 未検証・推測にとどまること

**ここを既成事実として扱わないこと。**

| 項目 | 状態 |
|---|---|
| ~~`counter.nw` の tangle 出力が**実機で動くか**~~ | **検証済みに移動 → §2.8** |
| ~~`.nw` を 4 つ目のファイルとして Gadget に置けるか~~ | **検証済みに移動 → §2.9**。ただし「エージェントが `.nw` をどう扱うか」は API キーがないため未検証のまま |
| 連動が切れた機序 | 未確認。「コード変更 → Gadget 再起動 → RPC 切断」と推測しているが、再起動を直接観測してはいない。§2.9 の 3 点も `client.js` を読んで立てた仮説 |
| tangle をどこで走らせるか | **未決**。ビルド工程が存在しないため差し込む場所がない |
| Source Map が Gadget のサンドボックスで機能するか | 未検証 |
| ~~`pnpm run-local` が動くか~~ | **検証済みに移動 → §2.6** |
| ~~`counter.gadget` のインポートが通るか~~ | **検証済みに移動 → §2.8** |
| ~~Blueprint から生成した Gadget が実際に動くか~~ | **検証済みに移動 → §2.8** |
| Gadget 画面の `Code` タブでファイルを追加・編集できるか | 未検証。手順4 はここを見るところから |
| Workshop でエージェントを動かすのに要る API キーの設定手順 | 未検証。起動とセットアップウィザードには不要と確認済み（§2.7）。キーを入れる先は `.dev.vars` と分かっているが、実際に入れて動かしてはいない |
| Cloudflare AI Gateway の無料枠の範囲 | 未検証。`docs/public-server.md` に "used for the free tier" とあるだけ |
| `gatekeeper-context` を外すと core が壊れるか | 未検証。壊れる恐れがあるので残している |
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
| `nweave` | Perl 製の最小 weaver（.nw → HTML） |
| `mkgadget.mjs` | `.gadget` Blueprint を組み立てる（Node）。実機へ載せる経路。詳細は §2.7 |
| `ckgadget.mjs` | `.gadget` を解いて検証する。`mkgadget` の対。純正の `.gadget` も解ける |
| `counter.nw` | 共有カウンタ Gadget の文芸的原本 ★中心的な成果物 |
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

```sh
cd reference/cloudflare-os
pnpm run-local          # → http://localhost:8787
```

`packageManager` は pnpm 11.17.0 が指定されている。

### 手順 2: 承認 UI を実際に見る

Gatekeeper を 1 つ設定して（README の各 gatekeeper パッケージに手順あり）、
副作用のある操作をエージェントにさせ、Activity パネルの挙動を確認する。
特に見たい点:

- pending の action がどう表示されるか
- 自動承認ルールを後から追加したとき、pending がその場で適用される様子
- `actionKind` を持たない action が「常に手動」として区別されているか

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

### 手順 4: `.nw` を 4 つ目のファイルとして置いてみる

置けるか、置いた場合にエージェントがどう扱うかを観察する。
理想は「エージェントが `.nw` を編集し、tangle して `server.js` に書き戻す」。
まずは手動でその往復を回してみて、成立するか確かめる。

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

### 6.2 散文の信頼性

エージェントが書いた散文は流暢だが誤りうる。
これは文芸的プログラミングの古典的失敗（散文とコードの乖離）の
AI 版であり、しかも「エージェントが再生成できるから解決」とはならない。
再生成される散文自体が捏造されうるからである。

**部分的な解**: 散文に証拠を持たせる。
「このチャンクはこう動くはずだ」ではなく
「このチャンクをこう呼んだらこう返った」を文書に埋める。
Gatekeeper のログ、テストの実行結果、tangle が通った事実。

### 6.3 追記機能を差分の単位にする

同名チャンクへの追記は、エージェントが機能を追加するときの
自然な操作単位になりうる。既存コードを書き換えるのではなく、
**新しい節を文書末尾に足し、既存チャンクに追記する**。
差分が「文書に一節加わった」という形で人間に見える。
通常の diff より読みやすいはずで、
「コードを読まずに変更内容を理解する」という目標に直結する。

### 6.4 チャンクの順序自由をどこまで許すか

Knuth の `tangle` の核心は提示順序と実行順序の分離だが、
自由にするほど tangle 後の行番号対応が複雑になる。
`#line` / Source Map で解けるはずだが、
Gadget のサンドボックスで機能するかは未検証（§3）。

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
