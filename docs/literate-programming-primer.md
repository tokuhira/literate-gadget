# 文芸的プログラミング最小入門 — Lisp / Perl 話者のための

この文書に載っているコードは、すべてサンドボックス上で実際に実行して出力を確認してあります。
検証結果は末尾にまとめてあります。

---

## 1. 一言でいうと

**チャンクは、ソーステキストレベルの名前付きマクロです。** それだけです。

Lisp で言えば、衛生的でない `defmacro` を、S 式ではなく生のテキストに対して定義し、
最後に一括展開する。Perl で言えば、名前を付けたヒアドキュメントを相互に差し込めるようにしたもの。

新しい概念は事実上ゼロで、Knuth の貢献は概念ではなく**その帰結**にあります。つまり、
テキストマクロを使えばコードの**提示順序**と**実行順序**を切り離せる、という一点。

- **実行順序**はコンパイラの都合（宣言が先、定義が後、初期化はここ、…）
- **提示順序**は人間の理解の都合（まず全体の骨格、細部はあとまわし）

この二つは一致しない。従来のプログラミングは前者に人間が合わせていた。文芸的
プログラミングは後者で書いて、機械的に前者へ変換する。変換器が `tangle` です。

同じ文書からもう一方向、人間向けの整形文書を作るのが `weave`。
一つの原文から二つの出力が出る、というのが全体像です。

```
                  ┌── tangle ──> コンパイル可能なソース
   .nw / .web ────┤
                  └── weave  ──> 読める文書（TeX / HTML）
```

---

## 2. 文法は二つ半

noweb 系の記法だけ覚えれば十分です。CWEB の制御コードは十数個ありますが、
**新しく作るものに CWEB を使う理由はありません**。

### (a) チャンクの定義

行頭の `<<名前>>=` で始まり、`@` だけの行で終わる。

```
<<篩を回す>>=
my @composite;
for (my $p = 2; $p * $p <= $limit; $p++) { ... }
@
```

### (b) チャンクの参照

チャンクの中で `<<名前>>` と書くと、そこに展開される。

```
<<*>>=
#!/usr/bin/env perl
<<定数の設定>>
<<篩を回す>>
@
```

`<<*>>` はルートチャンク（tangle の開始点）の慣例的な名前です。

### (c) 半分 — 追記

同じ名前を二度定義すると、置き換えではなく**末尾に追記**されます。
「グローバル変数」のような、文書のあちこちから少しずつ育っていく箇所のためのもの。

```
<<グローバル変数>>=
my $limit = 50;
@

（…別の話をしたあとで…）

<<グローバル変数>>=
my $verbose = 0;
@
```

以上。プロズ（散文）の側には一切の制約がありません。チャンクの外側は
tangler にとって無であり、Markdown でも TeX でも日本語の落書きでも構わない。

---

## 3. 実装 — Perl で 40 行

概念が本当に小さいことを納得してもらうには、実装を見るのが早いと思います。
以下は完全に動作する tangler です。

```perl
#!/usr/bin/env perl
# ntangle - a minimal noweb-style tangler
#   usage: ntangle [-r rootname] file.nw > output
use strict; use warnings;

my $root = '*';
if (@ARGV >= 2 && $ARGV[0] eq '-r') { shift; $root = shift; }

# ---- 1. 文書を読んでチャンクを集める。
#         チャンクの外側はすべて散文であり、tangler は単に無視する。
my (%chunk, %seen_order); my $cur;
while (my $line = <>) {
    if ($line =~ /^<<(.+)>>=\s*$/) {           # チャンク定義の開始
        $cur = $1;
        $chunk{$cur} ||= [];                    # 同名の再定義は追記になる
        $seen_order{$cur} //= scalar keys %seen_order;
        next;
    }
    if (defined $cur && $line =~ /^\@\s*$/) { $cur = undef; next; }  # 終端
    push @{$chunk{$cur}}, $line if defined $cur;
}

# ---- 2. ルートチャンクを再帰的に展開する。
#         参照は任意のインデント位置に置ける。そのインデントが展開後の
#         全行に前置されるので、インデントに意味のある言語でも壊れない。
sub expand {
    my ($name, $indent, $stack) = @_;
    die "ntangle: undefined chunk <<$name>>\n" unless exists $chunk{$name};
    die "ntangle: cycle: " . join(' -> ', @$stack, $name) . "\n"
        if grep { $_ eq $name } @$stack;
    my $out = '';
    for my $line (@{$chunk{$name}}) {
        if ($line =~ /^(\s*)<<(.+)>>\s*$/) {
            $out .= expand($2, $indent . $1, [@$stack, $name]);
        } else {
            $out .= $indent . $line;
        }
    }
    return $out;
}

print expand($root, '', []);
```

見どころは一箇所だけで、`expand` がインデントを引き回しているところです。
参照 `<<p の倍数を消す>>` が 4 空白のインデントで置かれていたら、展開結果の
全行に 4 空白が付く。これがないと Python や YAML で破綻しますし、
そうでない言語でも出力が読めなくなります。

Knuth の `tangle` はこれに加えて、Pascal の字句解析、マクロ (`@d`)、
`#line` 相当の情報などを扱いますが、**中核はこの再帰展開だけ**です。

---

## 4. 動く例

`demo.nw`（散文は省略、チャンクだけ抜き出すと）:

```
<<*>>=
#!/usr/bin/env perl
use strict; use warnings;
<<定数の設定>>
<<篩を回す>>
<<結果を表示する>>
@

<<定数の設定>>=
my $limit = 50;
@

<<篩を回す>>=
my @composite;
for (my $p = 2; $p * $p <= $limit; $p++) {
    next if $composite[$p];
    <<p の倍数を消す>>
}
@

<<p の倍数を消す>>=
for (my $q = $p * $p; $q <= $limit; $q += $p) {
    $composite[$q] = 1;
}
@

<<結果を表示する>>=
print join(' ', grep { !$composite[$_] } 2 .. $limit), "\n";
@
```

`./ntangle demo.nw` の出力:

```perl
#!/usr/bin/env perl
use strict; use warnings;
my $limit = 50;
my @composite;
for (my $p = 2; $p * $p <= $limit; $p++) {
    next if $composite[$p];
    for (my $q = $p * $p; $q <= $limit; $q += $p) {
        $composite[$q] = 1;
    }
}
print join(' ', grep { !$composite[$_] } 2 .. $limit), "\n";
```

実行結果:

```
2 3 5 7 11 13 17 19 23 29 31 37 41 43 47
```

内側のループが正しくインデントされて埋め込まれている点に注目してください。
循環参照は検出されます（`ntangle: cycle: a -> b -> a`）。

---

## 5. CWEB との対応

再履修する必要はありませんが、既存の CWEB ソースを読むときの対照表だけ置いておきます。

| CWEB | noweb 相当 | 意味 |
|---|---|---|
| `@ ` （@＋空白） | （区切りなし） | 節の開始。散文が始まる |
| `@*` | `#` 見出し | 章レベルの節。目次に載る |
| `@<名前@>=` | `<<名前>>=` | チャンク定義 |
| `@<名前@>` | `<<名前>>` | チャンク参照 |
| `@c` | `<<*>>=` | 無名（ルート）チャンクの開始 |
| `@d 名前 値` | — | C のマクロ定義（`#define` になる） |
| `@f x y` | — | weave に「x を y のように整形せよ」と指示 |
| `\|コード\|` | `` `コード` `` | 散文中にコード片を埋める |
| `@!` `@^` `@.` | — | 索引の制御 |

つまり本質的な差は「`@` 系の制御コードか山括弧か」だけで、
残りは **weave 側の組版と索引生成のための追加装備**です。
自分のプロジェクトで文芸的プログラミングをやるぶんには、まず要りません。

---

## 6. 検証結果（実測）

サンドボックスで実際に流したもの。

### 6.1 CWEB（`sieve.w`）

```
$ ctangle sieve.w && gcc -std=c99 -o sieve sieve.c && ./sieve
2 3 5 7 11 13 17 19 23 29 31 37 41 43 47
```

`ctangle` の出力には `#line` 指令が入ります。ここが後述の設計論に効きます。

```c
#define LIMIT 50 \

/*1:*/
#line 8 "sieve.w"

/*2:*/
#line 18 "sieve.w"

#include <stdio.h>

/*:2*/
#line 9 "sieve.w"
```

つまり **CWEB は 1980 年代の時点で source map 相当を持っていました**。
コンパイラのエラーは `.w` の行番号で報告されます。

### 6.2 オリジナルの WEB（Pascal、`primes.web`）

```
$ tangle primes.web    # -> primes.p
$ weave  primes.web    # -> primes.tex
$ pdftex primes.tex    # -> primes.pdf （4 ページ）
```

Knuth の本来のツールチェインがそのまま動きます。`weave` は索引と
相互参照を自動生成し、節番号の付いた組版済み文書を出します。

### 6.3 環境について

| ツール | 状態 |
|---|---|
| `tangle` / `weave`（Pascal WEB） | 使用可 |
| `ctangle` / `cweave`（CWEB） | tangle 可。**weave の PDF 化は不可** |
| `webmac.tex` | あり |
| `cwebmac.tex` | **なし**（root 権限も CTAN 接続もないため導入不可） |
| pTeX / upTeX / mendex | あり。`platex` / `uplatex` はなし |

CWEB の weave 出力を PDF にしたい場合は、`cwebmac.tex` をどこかから
持ち込む必要があります。TeX ソース自体は生成できています。

---

## 7. 本題への接続 — Blueprint を literate にするなら

Cloudflare OS の Blueprint を文芸的文書にする、という話に戻すと、
上の実験から言えることが三つあります。

### (a) source map は解決済みの問題である

前回「tangle するとスタックトレースの行番号が壊れる」と述べましたが、
CWEB の `#line` 出力を見るかぎり、**Knuth はこれを最初から解いていました**。
JavaScript / TypeScript には標準の Source Map v3 があるので、
tangler が `.map` を吐けば、ブラウザの devtools も Workers のスタックトレースも
`.nw` 側の行を指せます。技術的な障害はなく、単に書く手間の問題です。

### (b) 実装コストは驚くほど低い

上の tangler は 40 行です。TypeScript 対応にしても、source map 生成を
足して 150 行というところでしょう。**難しいのは weave 側**で、こちらは
「人間が読んで、エージェントに何を頼めばいいか判断できる文書」を
どう出すかという設計問題であり、コード量の問題ではありません。

### (c) 追記機能が効いてくる可能性

同名チャンクへの追記（2-c）は、エージェントが機能を追加するときの
自然な操作単位になり得ます。既存のコードを書き換えるのではなく、
**新しい節を文書の末尾に足して、既存のチャンクに追記する**。
差分が「文書に一節加わった」という形で人間に見える。
これは通常の diff より遥かに読みやすいはずで、
「TypeScript を読まずに変更内容を理解する」という当初の目標に直結します。

---

## 付録：ファイル一覧

| ファイル | 内容 |
|---|---|
| `ntangle` | Perl 製の最小 tangler（40 行、動作確認済み） |
| `nweave` | Perl 製の最小 weaver（.nw → HTML、動作確認済み） |
| `demo.nw` | 上記の文芸的プログラミング例（日本語散文＋Perl） |
| `demo.pl` | `demo.nw` を tangle した出力 |
| `demo.html` | `demo.nw` を weave した出力 |
| `sieve.w` | CWEB の例 |
| `primes.web` | オリジナル WEB（Pascal）の例 |
| `primes.pdf` | `primes.web` を weave して組版したもの（4 ページ） |
