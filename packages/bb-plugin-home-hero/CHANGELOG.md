# Changelog

## 0.1.1

- The greeting now reserves its finished width before typing, so the icon and
  greeting stay put while characters appear.
- A short opacity-only entrance leads the typing; the old horizontal slide and
  the competing composer glide are gone.
- Text is written only when the character count changes, and reduced motion
  still renders the complete greeting immediately.

## 0.1.0
- First public release in the `bb-plugins` collection.
- Time-of-day greeting with an optional name from settings.
- Optional PNG/JPEG/WebP icon upload (≤256 KiB) with structural validation, preview and removal.
- Scoped styling, reduced-motion support and single-owner cleanup on reload or disable.
