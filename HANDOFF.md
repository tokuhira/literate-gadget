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

両方 `node --check` を通過。**ただし実機では未実行**（§3 参照）。

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

---

## 3. 未検証・推測にとどまること

**ここを既成事実として扱わないこと。**

| 項目 | 状態 |
|---|---|
| `counter.nw` の tangle 出力が**実機で動くか** | 未検証。構文検査のみ |
| `.nw` を 4 つ目のファイルとして Gadget に置けるか | 未検証。Y.Map なので技術的には置けるはずだが、拡張子の制限やエージェントの扱いは不明 |
| tangle をどこで走らせるか | **未決**。ビルド工程が存在しないため差し込む場所がない |
| Source Map が Gadget のサンドボックスで機能するか | 未検証 |
| ~~`pnpm run-local` が動くか~~ | **検証済みに移動 → §2.6** |
| Workshop でエージェントを動かすのに要る API キーの設定手順 | 未検証。起動自体には不要と確認したが、その先は未確認 |
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
| `counter.nw` | 共有カウンタ Gadget の文芸的原本 ★中心的な成果物 |
| `server.js` / `client.js` | `counter.nw` の tangle 出力 |
| `counter.html` | `counter.nw` の weave 出力 |
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

### 手順 3: `counter.nw` を実機に載せる

`server.js` / `client.js` を新規 Gadget に貼り、2 つのブラウザで開いて
リアルタイム同期を確認する。**ここで初めて §2.5 が検証される。**

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
