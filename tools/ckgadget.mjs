#!/usr/bin/env node
// .gadget アーカイブを解いて検証する。mkgadget.mjs の対になる道具。
//
// 「動くはず」と「動かして確かめた」を分けるための装置。生成した .gadget を
// 実機に持ち込む前にここで潰せるものは潰しておく。cloudflare-os 純正の
// .gadget も解けるので、形式の理解が正しいかを実例で裏付けられる。
//
// 使い方:
//   node tools/ckgadget.mjs foo.gadget              # 構造を検証して中身を表示
//   node tools/ckgadget.mjs foo.gadget -c dir/      # dir/ の同名ファイルと内容を突き合わせる
//
// 検証の順序は blueprint-archive.ts の parseBlueprintArchive() に合わせてある。
// 実機で弾かれたときにどの段階の問題かを対応付けられるようにするため。

import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { createRequire } from "node:module";

const CFOS = "reference/cloudflare-os/packages/workshop-backend";
let Y;
try {
  Y = createRequire(`${process.cwd()}/${CFOS}/`)("yjs");
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

const args = process.argv.slice(2);
const ci = args.indexOf("-c");
const compareDir = ci !== -1 ? args[ci + 1] : null;
const target = args.filter((a, i) => a !== "-c" && i !== ci + 1)[0];
if (!target) {
  console.error("使い方: node tools/ckgadget.mjs foo.gadget [-c 突き合わせ先ディレクトリ]");
  process.exit(1);
}

const buf = readFileSync(target);
const fail = (m) => { console.error("NG:", m); process.exit(1); };

// --- プレフィックス ---------------------------------------------------------

if (buf.byteLength < PREFIX_BYTES) fail("プレフィックス 24 バイトに満たない");

const magic = buf.readBigUInt64BE(0);
console.log("マジック    0x" + magic.toString(16), magic === MAGIC ? "OK" : "NG");
if (magic !== MAGIC) fail("マジック不一致 → Invalid gadget archive magic number");

const version = buf.readUInt32BE(8);
console.log("形式版     ", version, version === VERSION ? "OK" : "NG");
if (version !== VERSION) fail(`形式版不一致 → Unsupported gadget archive version: ${version}`);

const metaSize = buf.readUInt32BE(12);
console.log("メタ長     ", metaSize, "バイト", metaSize > 0 && metaSize <= MAX_METADATA_BYTES ? "OK" : "NG");
if (metaSize === 0) fail("メタデータが空 → missing blueprint metadata");
if (metaSize > MAX_METADATA_BYTES) fail("メタデータが上限超過 → metadata size is out of range");

const contentLength = Number(buf.readBigUInt64BE(16));
console.log("本体長     ", contentLength, "バイト",
            Number.isSafeInteger(contentLength) && contentLength >= 0 ? "OK" : "NG");
if (!Number.isSafeInteger(contentLength) || contentLength < 0) fail("invalid content length");
if (contentLength > MAX_CONTENT_BYTES) fail("本体が上限超過 → content is too large");

// 宣言長と実バイト数の一致。importBlueprint が FixedLengthStream で見るので、
// ここが食い違うと実機でだけ落ちる。
const actual = buf.byteLength - PREFIX_BYTES - metaSize;
console.log("実バイト数 ", actual, actual === contentLength ? "OK 宣言長と一致" : `NG 宣言 ${contentLength}`);
if (actual !== contentLength) fail("content 長が宣言と食い違う（FixedLengthStream が拒否する）");

// --- メタデータ -------------------------------------------------------------

let meta;
try {
  meta = JSON.parse(buf.subarray(PREFIX_BYTES, PREFIX_BYTES + metaSize).toString("utf8"));
} catch (e) {
  fail("metadata is not valid JSON: " + e.message);
}

console.log("\n--- メタデータ ---");
for (const k of ["title", "description", "author", "created", "version", "lastUpdated", "bindings"]) {
  console.log(`  ${k.padEnd(12)}`, k in meta ? JSON.stringify(meta[k]) : "★欠落");
}
if ("output" in meta) console.log("  output      ", JSON.stringify(meta.output));

// reviveBlueprintMetadata は created / lastUpdated を new Date() に通す。
for (const k of ["created", "lastUpdated"]) {
  if (Number.isNaN(new Date(meta[k]).getTime())) fail(`${k} が Date に変換できない`);
}
console.log("  日付の復元   OK（reviveBlueprintMetadata 相当）");

// --- 本体 -------------------------------------------------------------------

console.log("\n--- 本体 ---");
let raw;
try {
  raw = gunzipSync(buf.subarray(PREFIX_BYTES + metaSize));
} catch (e) {
  fail("gzip 展開に失敗: " + e.message);
}
console.log("  gzip 展開    OK", raw.byteLength, "バイト");

const doc = new Y.Doc();
try {
  Y.applyUpdateV2(doc, new Uint8Array(raw));
} catch (e) {
  fail("applyUpdateV2 に失敗: " + e.message);
}
console.log("  applyUpdateV2 OK");

// initializeFromBlueprint と同じ読み方（無名ルート）
const files = [...doc.getMap().entries()];
if (files.length === 0) fail("無名ルートが空。ファイルが読み出せない");
console.log("  無名ルート   OK", files.length, "ファイル");
for (const [name, text] of files) {
  console.log(`    ${name.padEnd(14)} ${text.toString().length} 文字`);
}

// --- 突き合わせ（任意）------------------------------------------------------

if (compareDir) {
  console.log(`\n--- ${compareDir} との突き合わせ ---`);
  let ok = true;
  for (const [name, text] of files) {
    const path = join(compareDir, name);
    if (!existsSync(path)) { console.log(`  ${name.padEnd(14)} ★突き合わせ先にない`); ok = false; continue; }
    const same = text.toString() === readFileSync(path, "utf8");
    if (!same) ok = false;
    console.log(`  ${name.padEnd(14)} ${same ? "一致" : "★不一致"}`);
  }
  if (!ok) fail("内容が突き合わせ先と食い違う");
}

console.log("\n検証すべて通過。");
