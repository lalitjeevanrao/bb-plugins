#!/usr/bin/env bash
# Install the three bb-plugins packages, pinned to their published release tags.
#
# Run this on the other machine after the collection has been published.
# It installs into the BB instance that `bb` talks to; nothing is removed or
# upgraded automatically, and no prompt is skipped (add --yes yourself only if
# you mean it).
set -eu

REPO_URL="${REPO_URL:-https://github.com/lalitjeevanrao/bb-plugins.git}"

command -v bb >/dev/null 2>&1 || {
  echo "bb is required (BB 0.49.0 or newer): https://getbb.app" >&2
  exit 1
}

echo "==> Copilot session credits (v0.3.1)"
bb plugin install "git:${REPO_URL}@v0.3.1" --plugin copilot-session-credits

echo "==> Home Hero (home-hero/v0.1.1)"
bb plugin install "git:${REPO_URL}@home-hero/v0.1.1" --plugin home-hero

echo "==> Composer Auto-collapse (composer-autocollapse/v0.1.0)"
bb plugin install "git:${REPO_URL}@composer-autocollapse/v0.1.0" --plugin composer-autocollapse

echo "==> Done. Verify with: bb plugin list"

# Optional: the Pi companion from the same repository (skip if you do not use Pi).
# Requires Pi 1.5.0 or newer. It shares the credits tag, so no extra prefix.
#
# pi install "git:${REPO_URL}@v0.3.1"
