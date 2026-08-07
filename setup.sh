#!/usr/bin/env sh
# 初回セットアップ。WSL / Linux / macOS で動く。
set -e
cd "$(dirname "$0")"

echo "==> 実行権限を付ける（Windows から移すと落ちることがある）"
chmod +x tools/ntangle tools/nweave setup.sh

echo "==> 必須コマンドの確認"
for c in perl make git; do
  command -v "$c" >/dev/null || { echo "  見つからない: $c  （必須）"; exit 1; }
  echo "  $c: $(command -v $c)"
done

echo "==> 任意コマンドの確認"
HAVE_NODE=1
if command -v node >/dev/null; then
  echo "  node: $(node --version)"
else
  HAVE_NODE=0
  echo "  node: なし"
  echo "        tangle / weave 自体は Perl だけで動くので支障はない。"
  echo "        ただし以下の 2 つには Node が要る:"
  echo "          - make check（生成 JS の構文検査）"
  echo "          - HANDOFF.md 手順1 の pnpm run-local"
  echo "        Claude Code はネイティブバイナリなので Node とは無関係。"
  echo "        入れるなら Node 22 以降。例:"
  echo "          curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  echo "          nvm install 22 && corepack enable"
fi

if [ ! -d .git ]; then
  echo "==> git リポジトリを初期化"
  git init -q && git add -A && git commit -qm "初期状態: 文芸的 Gadget の骨組み"
else
  echo "==> git リポジトリは既にある"
fi

CFOS_REPO=https://github.com/tokuhira/cloudflare-os.git
CFOS_BRANCH=literate-gadget-minimal

if [ ! -d reference/cloudflare-os ]; then
  echo "==> cloudflare-os を clone（フォークの $CFOS_BRANCH、23MB 程度）"
  git clone --depth 1 -b "$CFOS_BRANCH" -q "$CFOS_REPO" reference/cloudflare-os
  git -C reference/cloudflare-os remote add upstream https://github.com/cloudflare/cloudflare-os.git
  git -C reference/cloudflare-os remote set-url --push upstream DISABLED-do-not-push-upstream
else
  echo "==> reference/cloudflare-os は既にある（ブランチ: $(git -C reference/cloudflare-os branch --show-current)）"
fi

echo "==> tangle / weave を実行"
make

if [ "$HAVE_NODE" = "1" ]; then
  echo "==> 構文検査"
  make check
else
  echo "==> 構文検査は飛ばす（node なし）"
fi

echo
echo "完了。次は HANDOFF.md の §5 を読んでください。"
