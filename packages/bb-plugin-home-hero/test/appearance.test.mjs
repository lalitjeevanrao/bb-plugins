import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateIconDataUrl, normalizeDisplayName, MAX_ICON_BYTES } from "../appearance.ts";

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const dataUrl = (mime, value) => `data:${mime};base64,${Buffer.from(value).toString("base64")}`;
const PNG = fixture("icon.png");
const JPEG = fixture("icon.jpg");
const WEBP = fixture("icon.webp");

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const rejects = (fn, pattern) => assert.throws(fn, pattern);

test("normalizeDisplayName trims and keeps blank", () => {
  assert.equal(normalizeDisplayName("  Alex  "), "Alex");
  assert.equal(normalizeDisplayName(""), "");
  assert.equal(normalizeDisplayName("   "), "");
  assert.equal(normalizeDisplayName(undefined), "");
  assert.equal(normalizeDisplayName(42), "");
  assert.equal(normalizeDisplayName("x".repeat(80)).length, 80);
});

test("normalizeDisplayName rejects names over 80 characters", () => {
  rejects(() => normalizeDisplayName("x".repeat(81)), /80 characters/);
});

test("accepts complete PNG, JPEG and WebP fixtures", () => {
  assert.equal(validateIconDataUrl(dataUrl("image/png", PNG)), dataUrl("image/png", PNG));
  assert.equal(validateIconDataUrl(dataUrl("image/jpeg", JPEG)), dataUrl("image/jpeg", JPEG));
  assert.equal(validateIconDataUrl(dataUrl("image/webp", WEBP)), dataUrl("image/webp", WEBP));
});

test("null and undefined clear the icon", () => {
  assert.equal(validateIconDataUrl(null), null);
  assert.equal(validateIconDataUrl(undefined), null);
});

test("rejects non-data-URL values and unsupported types", () => {
  rejects(() => validateIconDataUrl("https://example.com/icon.png"), /data URL/);
  rejects(() => validateIconDataUrl(dataUrl("image/svg+xml", PNG)), /PNG, JPEG or WebP/);
  rejects(() => validateIconDataUrl("data:image/png;base64,"), /base64/);
});

test("rejects malformed base64", () => {
  rejects(() => validateIconDataUrl("data:image/png;base64,%%%"), /base64/);
  rejects(() => validateIconDataUrl("data:image/png;base64,AAAAA"), /base64/);
  rejects(() => validateIconDataUrl("data:image/png;base64,AB=!"), /base64/);
});

test("rejects SVG content and disguised uploads", () => {
  rejects(() => validateIconDataUrl(dataUrl("image/png", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))), /not a PNG, JPEG or WebP/);
  rejects(() => validateIconDataUrl(dataUrl("image/png", JPEG)), /does not match/);
  rejects(() => validateIconDataUrl(dataUrl("image/webp", PNG)), /does not match/);
});

test("rejects signature-only files", () => {
  rejects(() => validateIconDataUrl(dataUrl("image/png", PNG.subarray(0, 8))), /incomplete|not a PNG/);
  rejects(() => validateIconDataUrl(dataUrl("image/jpeg", JPEG.subarray(0, 2))), /incomplete|not a PNG/);
  rejects(() => validateIconDataUrl(dataUrl("image/webp", WEBP.subarray(0, 12))), /incomplete/);
});

test("rejects truncated files", () => {
  rejects(() => validateIconDataUrl(dataUrl("image/png", PNG.subarray(0, PNG.length - 12))), /incomplete/);
  rejects(() => validateIconDataUrl(dataUrl("image/jpeg", JPEG.subarray(0, JPEG.length - 2))), /incomplete|not a PNG/);
  rejects(() => validateIconDataUrl(dataUrl("image/webp", WEBP.subarray(0, WEBP.length - 10))), /incomplete/);
});

test("rejects a header with zero dimensions", () => {
  const zeroWidth = Buffer.from(PNG);
  zeroWidth.writeUInt32BE(0, 16);
  rejects(() => validateIconDataUrl(dataUrl("image/png", zeroWidth)), /incomplete/);
});

test("enforces the 256 KiB limit on decoded bytes", () => {
  const padded = Buffer.concat([PNG, Buffer.alloc(MAX_ICON_BYTES - PNG.length)]);
  // Trailing bytes after IEND are not a complete PNG.
  rejects(() => validateIconDataUrl(dataUrl("image/png", padded)), /incomplete/);
  const overLimit = Buffer.concat([PNG, Buffer.alloc(MAX_ICON_BYTES + 1 - PNG.length)]);
  rejects(() => validateIconDataUrl(dataUrl("image/png", overLimit)), /256 KiB/);
});

test("rejects a WebP whose RIFF size disagrees with the file length", () => {
  const wrongSize = Buffer.from(WEBP);
  wrongSize.writeUInt32LE(wrongSize.readUInt32LE(4) - 2, 4);
  rejects(() => validateIconDataUrl(dataUrl("image/webp", wrongSize)), /incomplete/);
});

let failed = 0;
for (const { name, fn } of cases) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok ${name}\n${error.stack}`);
  }
}
process.exitCode = failed ? 1 : 0;
