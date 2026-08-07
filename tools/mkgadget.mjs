#!/usr/bin/env node
// .gadget Blueprint アーカイブを組み立てる。
//
// counter.nw の tangle 出力を Cloudflare OS に持ち込むための道具。エージェント
// （＝LLM の API キー）を使わずに Gadget を実機へ載せるのが目的で、Blueprints
// 画面からインポートする .gadget ファイルを作る。
//
// 使い方:
//   node tools/mkgadget.mjs -o out.gadget -t "タイトル" file1.js file2.js
//
// 形式は reference/cloudflare-os の実装から読み取った（HANDOFF.md §2.2 も参照）。
// 出典は blueprint-archive.ts の encodeBlueprintArchivePrefix() と
// overseer.ts の initializeFromBlueprint()。
//
//   0..7   マジック 0xec2e2d3a2300e317   (BigUint64, ビッグエンディアン)
//   8..11  形式版 1                      (Uint32)
//   12..15 メタデータの JSON バイト長     (Uint32)
//   16..23 本体のバイト長（gzip 後）      (BigUint64)
//          メタデータ JSON (UTF-8)
//          gzip した Yjs V2 更新
//
// 本体の Yjs doc は**無名ルート**の Y.Map で、キーがファイル名、値が Y.Text。
// overseer.ts のコメントに "the archive always uses the unnamed root" とある。

import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { basename } from "node:path";
import { createRequire } from "node:module";

// yjs は cloudflare-os 側の依存から借りる。このリポジトリは perl/make/git だけを
// 必須にしておきたいので、package.json を足さずに解決する。pnpm はワークスペース
// ごとにリンクするため、yjs を直接依存に持つ workshop-backend を基準にする。
const CFOS = "reference/cloudflare-os/packages/workshop-backend";
const require_ = createRequire(`${process.cwd()}/${CFOS}/`);
let Y;
try {
  Y = require_("yjs");
} catch {
  console.error(`yjs が見つからない (${CFOS} から解決を試みた)。`);
  console.error("先に reference/cloudflare-os で pnpm install を済ませること。");
  process.exit(1);
}

const MAGIC = 0xec2e2d3a2300e317n;
const VERSION = 1;
const PREFIX_BYTES = 24;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_CONTENT_BYTES = 32 * 1024 * 1024;

function parseArgs(argv) {
  const opts = { out: null, title: null, description: null, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o") opts.out = argv[++i];
    else if (a === "-t") opts.title = argv[++i];
    else if (a === "-d") opts.description = argv[++i];
    else opts.files.push(a);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.out || opts.files.length === 0) {
  console.error("使い方: node tools/mkgadget.mjs -o out.gadget -t タイトル [-d 説明] file...");
  process.exit(1);
}
const title = opts.title ?? basename(opts.out, ".gadget");

// --- 本体: 無名ルートの Y.Map に「ファイル名 → Y.Text」を並べる ---------------

const doc = new Y.Doc();
const root = doc.getMap();          // 引数なし = 無名ルート ""
doc.transact(() => {
  for (const path of opts.files) {
    const text = new Y.Text();
    text.insert(0, readFileSync(path, "utf8"));
    root.set(basename(path), text);
  }
});

const content = gzipSync(Buffer.from(Y.encodeStateAsUpdateV2(doc)));
if (content.byteLength > MAX_CONTENT_BYTES) {
  console.error(`本体が上限 ${MAX_CONTENT_BYTES} バイトを超えた。`);
  process.exit(1);
}

// --- メタデータ ---------------------------------------------------------------
//
// output は省略する。blueprint-archive.ts に "Absent means a generic app" とあり、
// 不正な値は degrade させる方針なので、余計な宣言をしないほうが安全。
// bindings も counter は外部接続を持たないので空でよい。

const now = new Date().toISOString();
const metadata = {
  title,
  description: opts.description
    ?? `文芸的プログラミングの実験。${opts.files.map(f => basename(f)).join(" と ")} は .nw 原本からの tangle 出力。`,
  author: { type: "user", id: "literate-gadget", name: "literate-gadget" },
  created: now,
  version: 1,
  lastUpdated: now,
  bindings: {},
};

const metadataBytes = Buffer.from(JSON.stringify(metadata), "utf8");
if (metadataBytes.byteLength > MAX_METADATA_BYTES) {
  console.error(`メタデータが上限 ${MAX_METADATA_BYTES} バイトを超えた。`);
  process.exit(1);
}

// --- 連結 ---------------------------------------------------------------------

const prefix = Buffer.alloc(PREFIX_BYTES);
prefix.writeBigUInt64BE(MAGIC, 0);
prefix.writeUInt32BE(VERSION, 8);
prefix.writeUInt32BE(metadataBytes.byteLength, 12);
prefix.writeBigUInt64BE(BigInt(content.byteLength), 16);

writeFileSync(opts.out, Buffer.concat([prefix, metadataBytes, content]));

console.log(`書き出した: ${opts.out}`);
console.log(`  タイトル  ${title}`);
console.log(`  ファイル  ${opts.files.map(f => basename(f)).join(", ")}`);
console.log(`  メタ長    ${metadataBytes.byteLength} バイト`);
console.log(`  本体長    ${content.byteLength} バイト（gzip 後）`);
