#!/bin/bash
# Postinstall script: patch tree-sitter-arkts with our custom grammar
# Runs after npm install to apply grammar fixes and rebuild native addon.
# Another machine can use the patched parser after npm install.

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$PROJECT_DIR/vendor/tree-sitter-arkts"
TARGET_DIR="$PROJECT_DIR/node_modules/tree-sitter-arkts"

if [ ! -d "$TARGET_DIR" ]; then
  echo "[tree-sitter-arkts-patch] node_modules/tree-sitter-arkts not found, skipping"
  exit 0
fi

if [ ! -f "$VENDOR_DIR/grammar.js" ]; then
  echo "[tree-sitter-arkts-patch] vendor/tree-sitter-arkts/grammar.js not found, skipping"
  exit 0
fi

echo "[tree-sitter-arkts-patch] Patching tree-sitter-arkts with custom grammar..."

# 1. Copy grammar.js and parser.c
cp "$VENDOR_DIR/grammar.js" "$TARGET_DIR/grammar.js"
cp "$VENDOR_DIR/src/parser.c" "$TARGET_DIR/src/parser.c"

# 2. Regenerate parser.c (ensures compatibility with current tree-sitter version)
cd "$TARGET_DIR"
npx tree-sitter generate 2>&1 || echo "[tree-sitter-arkts-patch] Warning: tree-sitter generate had issues (check conflicts)"

# 3. Rebuild native addon
npx node-gyp rebuild 2>&1

echo "[tree-sitter-arkts-patch] Done. tree-sitter-arkts patched and rebuilt."
