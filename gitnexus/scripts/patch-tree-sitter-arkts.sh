#!/bin/bash
# Apply type_assertion patch to tree-sitter-arkts grammar
# Usage: bash scripts/patch-tree-sitter-arkts.sh
set -e

PATCH_DIR="$(cd "$(dirname "$0")/.." && pwd)/patches"
ARKTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/node_modules/tree-sitter-arkts"

if [ ! -d "$ARKTS_DIR" ]; then
  echo "tree-sitter-arkts not found, skipping patch"
  exit 0
fi

# Check if already patched
if grep -q "type_assertion" "$ARKTS_DIR/grammar.js" 2>/dev/null; then
  echo "tree-sitter-arkts already patched with type_assertion"
  exit 0
fi

echo "Patching tree-sitter-arkts grammar..."
cd "$ARKTS_DIR"

# Apply grammar patch
patch -p0 < "$PATCH_DIR/tree-sitter-arkts-type-assertion.patch"

# Regenerate parser
npx tree-sitter generate

# Rebuild native binding
npx node-gyp rebuild

echo "tree-sitter-arkts patched and rebuilt successfully"
