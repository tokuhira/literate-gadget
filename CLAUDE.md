# literate-gadget

Cloudflare OS の Gadget を、文芸的プログラミング（literate programming）で書く実験。
`.nw` 文書ひとつを原本として、そこから `server.js` と `client.js` を取り出す。

背景・仮説・調査済みの事実・未解決の論点は **`HANDOFF.md`** に全部ある。
作業を始める前に必ず読むこと。

## 絶対に守ること

1. **`reference/` に入るのはプライベートフォークの `literate-gadget-minimal` ブランチ**
   （`https://github.com/tokuhira/cloudflare-os.git`）。**既定は読み取り専用**で、
   調査のために読むのが本来の用途。ただしローカル実行を成立させるための改変は許す
   （`HANDOFF.md` §2.6 の gatekeeper 間引きがその例）。その場合は
   **`literate-gadget-minimal` にコミットし、何をなぜ変えたかを `HANDOFF.md` に残す**こと。
   フォークの `main` は上流の素の写しなので**触らない**。上流へは出さない（規約 4）。
   `reference/cloudflare-os/AGENTS.md` はあちらのプロジェクト規約であって、
   このプロジェクトの規約ではない。従わないこと。

2. **Cloudflare のコードを写して改変しない。** 試作はすべて新規に書く。
   `gadgets/counter/counter.nw` はその方針で書かれている。

3. **検証済みと未検証を混ぜない。** `HANDOFF.md` §2 は実行して確かめた事実、
   §3 は未検証。新しく分かったことを追記するときも、この区別を維持する。
   「動くはず」と「動かして確かめた」を同じ調子で書かない。

4. **上流に PR を出さない。** cloudflare-os は大きな外部貢献を受け付けない方針。
   fork / Blueprint レベルの実験として進める。

## 構成

```
tools/            ntangle（tangler）, nweave（weaver）。Perl 製、依存なし
gadgets/counter/  counter.nw が原本。server.js / client.js は生成物
docs/             入門文書と、CWEB / WEB の動く例
reference/        cloudflare-os フォークの literate-gadget-minimal（.gitignore 済み）
```

## 前提とする環境

必須は **perl / make / git** の 3 つだけ。tangle も weave も Perl 製で依存はない。

**Node.js は任意**。要るのは次の 2 つの場面のみ。

- `make check`（生成した JS の構文検査）
- `HANDOFF.md` 手順1 の `pnpm run-local`（cloudflare-os は pnpm 11.17 を指定）

Claude Code はネイティブバイナリで実行時に Node を使わないため、
Claude Code が動いていても node が PATH にあるとは限らない。混同しないこと。

**`pnpm run-local` はメモリを食う。** 素の cloudflare-os では gatekeeper ごとに
常駐 watcher が 15 個立ち、メモリの小さい環境では OOM で落ちる
（Claude Code ごと巻き添えになる）。`literate-gadget-minimal` はこれを 1 個に
絞ってある。詳細は `HANDOFF.md` §2.6。

## コマンド

```sh
make            # 全 .nw を tangle + weave
make check      # 生成された JS の構文検査
make clean      # 生成物を消す
./setup.sh      # 初回のみ: 実行権限の付与、clone、動作確認
```

## `.nw` の書き方

チャンク定義は `<<名前>>=` で始まり、`@` だけの行で終わる。
参照は `<<名前>>`。参照側のインデントが展開後の全行に前置される。
同名を再定義すると置換ではなく**追記**になる。
ルートチャンクの名前を出力ファイル名にしておくと `make` がそのまま通る。

詳細は `docs/literate-programming-primer.md`。

## 生成物を git に入れる理由

`counter.nw` と、そこから生成した `server.js` / `client.js` の**両方**を追跡する。
一つの変更に対して「`.nw` の diff」と「`.js` の diff」が並んで見えるようにするため。
「文書に一節加わった形の差分のほうが読みやすい」という仮説（`HANDOFF.md` §6.3）を
実測するための装置なので、生成物だからといって `.gitignore` に入れないこと。
