# Changelog

## 0.1.3

- The icon setting now renders as a native settings card row, matching the
  host's Greeting name row: same label and helper typography, card border,
  padding and background, responsive stacking on narrow panels.
- Upload, replace and remove use one busy lifecycle across decode, validation
  and save; errors keep the previous icon and are announced through a status
  region that stays invisible while idle.
- The hidden file input is no longer a Tab stop; the visible button owns the
  keyboard flow and opens the native picker.

## 0.1.2

- The greeting types from the center outward again, like 0.1.0: the text grows
  in both directions and the icon moves out as characters appear.
- The opacity entrance still finishes before typing, text is still written only
  when the character count changes, and reduced motion or a missing
  animation-frame API still show the full greeting immediately.

## 0.1.1

- The greeting reserves its finished width before typing, so the icon and
  greeting stay put while characters appear.
- The opacity entrance finishes before typing starts, and text is written only
  when the character count changes.
- When animation frames are unavailable, the complete greeting is shown, and
  reduced motion still renders it immediately.

## 0.1.0
- First public release in the `bb-plugins` collection.
- Time-of-day greeting with an optional name from settings.
- Optional PNG/JPEG/WebP icon upload (≤256 KiB) with structural validation, preview and removal.
- Scoped styling, reduced-motion support and single-owner cleanup on reload or disable.
