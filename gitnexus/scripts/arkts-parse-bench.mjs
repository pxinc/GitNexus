#!/usr/bin/env node

/**
 * ArkTS Parse Rate Benchmark
 *
 * Parses all .ets files from the HarmonyOS application samples corpus
 * using tree-sitter-arkts and reports success/error/crash counts.
 *
 * Usage:
 *   node scripts/arkts-parse-bench.mjs              # Summary only
 *   node scripts/arkts-parse-bench.mjs --deep       # Detailed per-file error analysis
 *   node scripts/arkts-parse-bench.mjs --deep --limit 20  # Limit deep output
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
let Parser;
let ArkTS;
try {
  Parser = _require('tree-sitter');
  ArkTS = _require('@mtfe/tree-sitter-arkts');
} catch {
  try {
    Parser = _require('tree-sitter');
    ArkTS = _require('tree-sitter-arkts');
  } catch (e) {
    console.error('Failed to load tree-sitter-arkts:', e.message);
    process.exit(1);
  }
}

const DEFAULT_SAMPLES_DIR = '/Users/pengxingcheng/Dev/AIDev/applications_app_samples/code';
const SAMPLES_DIR =
  process.argv
    .find((a) => a.startsWith('--dir='))
    ?.split('=')
    .slice(1)
    .join('=') ||
  process.argv[process.argv.indexOf('--dir') + 1] ||
  DEFAULT_SAMPLES_DIR;
const DEEP = process.argv.includes('--deep');
const LIMIT =
  parseInt(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]) ||
  (process.argv.indexOf('--limit') !== -1
    ? parseInt(process.argv[process.argv.indexOf('--limit') + 1])
    : Infinity);

async function walkDir(dir, ext) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath, ext)));
    } else if (entry.name.endsWith(ext)) {
      files.push(fullPath);
    }
  }
  return files;
}

function categorizeError(source, rootNode) {
  const text = source;
  const errorStr = rootNode.toString();

  // Large component/class with many members
  if (
    (text.match(/@Component|struct\s+\w+/g) || []).length >= 1 &&
    (text.match(/\n/g) || []).length > 200
  ) {
    return 'large_component_glr';
  }

  // Callback closure cascade: deep nesting with });
  if ((text.match(/\}\);/g) || []).length > 5) {
    return 'callback_closure';
  }

  // Type assertion <string>expr
  if (/<\w+>\s*[a-zA-Z_$]/.test(text) && !/import.*from|<.*>/.test(text.slice(0, 100))) {
    const typeAssertionMatch = text.match(
      /<\s*(?:string|number|boolean|any|void|object|never|unknown)\s*>/,
    );
    if (typeAssertionMatch) return 'type_assertion';
  }

  // Import-related
  const firstError = findFirstError(rootNode);
  if (firstError) {
    const line = text.split('\n')[firstError.startPosition.row] || '';
    if (/import\s/.test(line)) return 'import_syntax';
  }

  return 'other';
}

function findFirstError(node) {
  if (node.type === 'ERROR' || node.isError) return node;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    const result = findFirstError(child);
    if (result) return result;
  }
  return null;
}

function countErrors(node) {
  let count = 0;
  if (node.type === 'ERROR' || node.isError) count++;
  for (let i = 0; i < node.childCount; i++) {
    count += countErrors(node.child(i));
  }
  return count;
}

async function main() {
  console.log('Loading tree-sitter-arkts...');
  const parser = new Parser();
  parser.setLanguage(ArkTS);

  console.log(`Scanning ${SAMPLES_DIR} for .ets files...`);
  const files = await walkDir(SAMPLES_DIR, '.ets');
  console.log(`Found ${files.length} .ets files\n`);

  const results = {
    total: files.length,
    success: 0,
    error: 0,
    crash: 0,
    errorFiles: [],
    categories: {
      large_component_glr: 0,
      callback_closure: 0,
      type_assertion: 0,
      import_syntax: 0,
      other: 0,
    },
  };

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const relPath = relative(SAMPLES_DIR, filePath);

    let source;
    try {
      source = await readFile(filePath, 'utf-8');
    } catch {
      results.crash++;
      results.errorFiles.push({
        file: relPath,
        category: 'read_error',
        error: 'Failed to read file',
      });
      continue;
    }

    let tree;
    try {
      tree = parser.parse(source);
    } catch (e) {
      results.crash++;
      results.errorFiles.push({ file: relPath, category: 'crash', error: e.message });
      continue;
    }

    const hasError = tree.rootNode.hasError;
    if (hasError) {
      results.error++;
      const category = categorizeError(source, tree.rootNode);
      results.categories[category]++;

      const firstError = findFirstError(tree.rootNode);
      const errorCount = countErrors(tree.rootNode);
      const errorLine = firstError
        ? source.split('\n')[firstError.startPosition.row]?.slice(0, 120)
        : null;

      const entry = {
        file: relPath,
        category,
        errorCount,
        firstErrorLine: firstError?.startPosition.row,
        firstErrorSnippet: errorLine,
      };

      results.errorFiles.push(entry);
    } else {
      results.success++;
    }

    if ((i + 1) % 1000 === 0) {
      process.stdout.write(
        `  ${i + 1}/${files.length} (${(((i + 1) / files.length) * 100).toFixed(1)}%)\r`,
      );
    }
  }

  // Print summary
  const rate = ((results.success / results.total) * 100).toFixed(2);
  console.log('\n=== Parse Rate Benchmark Results ===');
  console.log(`Total:    ${results.total}`);
  console.log(`Success:  ${results.success} (${rate}%)`);
  console.log(`Errors:   ${results.error}`);
  console.log(`Crashes:  ${results.crash}`);
  console.log(`\nError Categories:`);
  for (const [cat, count] of Object.entries(results.categories)) {
    console.log(`  ${cat}: ${count}`);
  }

  // Deep output
  if (DEEP) {
    console.log(`\n=== Error Files (top ${Math.min(LIMIT, results.errorFiles.length)}) ===`);
    const sorted = [...results.errorFiles].sort((a, b) => a.firstErrorLine - b.firstErrorLine);
    for (const e of sorted.slice(0, LIMIT)) {
      console.log(`[${e.category}] ${e.file}`);
      if (e.firstErrorSnippet) {
        console.log(`  L${e.firstErrorLine}: ${e.firstErrorSnippet}`);
      }
      console.log(`  errorCount: ${e.errorCount}`);
    }
  }

  // Save results
  const outPath = join(import.meta.dirname, 'arkts-bench-results.json');
  await writeFile(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outPath}`);

  // Exit code
  process.exit(results.crash > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
