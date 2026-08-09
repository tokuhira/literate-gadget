# literate-gadget

Cloudflare OS の Gadget を文芸的プログラミングで書く実験。

```sh
./setup.sh                    # 初回のみ
make                          # tangle + weave
make check                    # 構文検査
make witness                  # 証拠の付いていない節を出す
make witness VERIFY=1         # 証言の引用が出典に実在するか裏取りする
```

道具はすべて依存なし。tangle と weave と witness は Perl 製で、
`.gadget` を扱う 2 つだけ Node を使う。

| 道具 | 役割 |
|---|---|
| `tools/ntangle` | 文書からコードを取り出す（綯う） |
| `tools/nweave` | 文書を HTML に組む（織る） |
| `tools/nwitness` | 記述の裏付けを集計する（証す） |
| `tools/mkgadget.mjs` | `.gadget` を組み立てて実機へ持ち込む |
| `tools/ckgadget.mjs` | `.gadget` を解いて検証する |

`.nw` の平文は既定で「未証」であり、`@証` の行を置いたところにだけ裏付けが付く。
種類は **物証**（動かして観察した）/ **証言**（出典が述べている）/
**推理**（コードを読んで導いた）の三つ。緩く使うなら `nwitness` を走らせなければ
何も強制されず、走らせれば未証の節が TODO になる。

- 背景・調査結果・次の手順 → `HANDOFF.md`
- 作業上の規約 → `CLAUDE.md`
- noweb / CWEB の入門 → `docs/literate-programming-primer.md`

## ライセンス

MIT。`LICENSE` を参照。

`reference/` に置く cloudflare-os は追跡対象外で、このライセンスの範囲にない。
