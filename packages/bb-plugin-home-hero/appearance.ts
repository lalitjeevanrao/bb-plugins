export const MAX_DISPLAY_NAME = 80;
export const MAX_ICON_BYTES = 256 * 1024;
export const ICON_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Trimmed greeting name. Throws when the stored value exceeds the documented limit. */
export function normalizeDisplayName(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > MAX_DISPLAY_NAME) throw new Error(`Name must be ${MAX_DISPLAY_NAME} characters or fewer.`);
  return text;
}

function sniffMime(bytes: Uint8Array): (typeof ICON_MIME_TYPES)[number] | null {
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

const u32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
const u32le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

/** PNG: chunk walk from IHDR to a trailing IEND, so a bare signature or a cut file fails. */
function isCompletePng(bytes: Uint8Array): boolean {
  let offset = 8;
  let first = true;
  while (offset + 12 <= bytes.length) {
    const length = u32(bytes, offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    if (first) {
      if (type !== "IHDR" || length !== 13) return false;
      if (u32(bytes, offset + 8) === 0 || u32(bytes, offset + 12) === 0) return false;
      first = false;
    }
    if (type === "IEND") return end === bytes.length;
    offset = end;
  }
  return false;
}

const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** JPEG: walk markers to a frame header, require entropy data and a final EOI. */
function isCompleteJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  let offset = 2;
  let sawFrame = false;
  while (offset + 2 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1];
    if (marker === 0xd9) return sawFrame && offset + 2 === bytes.length;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return false;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return false;
    if (marker === 0xda) {
      if (!sawFrame) return false;
      return bytes.length >= offset + 2 + length + 2 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    }
    const end = offset + 2 + length;
    if (end > bytes.length) return false;
    if (JPEG_FRAME_MARKERS.has(marker)) sawFrame = true;
    offset = end;
  }
  return false;
}

/** WebP: RIFF size must cover the whole file and a VP8/VP8L bitstream chunk must exist. */
function isCompleteWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 20) return false;
  if (u32le(bytes, 4) + 8 !== bytes.length) return false;
  let offset = 12;
  let sawBitstream = false;
  while (offset + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = u32le(bytes, offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (size === 0 || end > bytes.length) return false;
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    if (fourcc === "VP8 ") {
      if (size < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return false;
      sawBitstream = true;
    } else if (fourcc === "VP8L") {
      if (data[0] !== 0x2f) return false;
      sawBitstream = true;
    } else if (fourcc === "VP8X" && size !== 10) {
      return false;
    }
    offset = end;
  }
  return sawBitstream && offset === bytes.length;
}

function isCompleteImage(mime: (typeof ICON_MIME_TYPES)[number], bytes: Uint8Array): boolean {
  if (mime === "image/png") return isCompletePng(bytes);
  if (mime === "image/jpeg") return isCompleteJpeg(bytes);
  return isCompleteWebp(bytes);
}

const BASE64 = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/;
const invalid = (message: string) => new Error(message);

/**
 * Validate an uploaded icon data URL and return its canonical form, or null to
 * remove the stored icon. Content is sniffed and structurally parsed, so a
 * declared MIME label, a bare signature or a truncated file never passes:
 * malformed, oversized and disguised uploads throw instead.
 */
export function validateIconDataUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalid("Icon must be an image data URL.");
  const match = BASE64.exec(value);
  if (!match) throw invalid("Icon must be a base64 PNG, JPEG or WebP data URL.");
  const [, declared, payload] = match as unknown as [string, (typeof ICON_MIME_TYPES)[number], string];
  if (!payload || payload.length % 4 !== 0) throw invalid("Icon data is not valid base64.");
  if (payload.length > Math.ceil(MAX_ICON_BYTES / 3) * 4) throw invalid("Icon must be 256 KiB or smaller.");
  let binary: string;
  try { binary = atob(payload); } catch { throw invalid("Icon data is not valid base64."); }
  if (btoa(binary) !== payload) throw invalid("Icon data is not valid base64.");
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (!bytes.length) throw invalid("Icon data is empty.");
  if (bytes.length > MAX_ICON_BYTES) throw invalid("Icon must be 256 KiB or smaller.");
  const sniffed = sniffMime(bytes);
  if (!sniffed) throw invalid("Icon data is not a PNG, JPEG or WebP image.");
  if (sniffed !== declared) throw invalid("Icon content does not match its declared type.");
  if (!isCompleteImage(sniffed, bytes)) throw invalid("Icon image is incomplete or corrupted.");
  return `data:${sniffed};base64,${payload}`;
}
