# Changelog

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
