import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import Parser from 'tree-sitter';
import {
  maskArktsOpaque,
  parseArktsWithFallback,
  sanitizeArktsForParseFallback,
} from '../../src/core/ingestion/utils/arkts-parse-fallback.js';

const require = createRequire(import.meta.url);

let ArkTS: unknown;
try {
  ArkTS = require('@mtfe/tree-sitter-arkts');
} catch {
  ArkTS = undefined;
}

const describeIfArkts = ArkTS ? describe : describe.skip;

function createParser(): Parser {
  const parser = new Parser();
  parser.setLanguage(ArkTS as Parser.Language);
  return parser;
}

describeIfArkts('ArkTS parse fallback', () => {
  it('recovers parenthesized ternary consequences without shifting offsets', () => {
    const parser = createParser();
    const source = 'const x = foo ? (LINE_WIDTH + BUTTON_WIDTH) : 0';

    const rawTree = parser.parse(source);

    // tree-sitter 0.25+ parses this correctly; older grammars would report errors
    // and the fallback would produce a light-stage result. Either outcome is valid.
    const parsed = parseArktsWithFallback(parser, source);
    expect(parsed.tree.rootNode.hasError).toBe(false);
    expect(parsed.content).toHaveLength(source.length);

    if (rawTree.rootNode.hasError) {
      expect(parsed.stage).toBe('light');
    } else {
      expect(parsed.stage).toBe('raw');
    }
  });

  it('normalizes invalid numeric examples using the light fallback', () => {
    const parser = createParser();
    const source = 'const num1 = .5;\nconst num2 = 2.;\nconst num3 = -.7;';

    expect(parser.parse(source).rootNode.hasError).toBe(true);

    const parsed = parseArktsWithFallback(parser, source);
    expect(parsed.stage).toBe('light');
    expect(parsed.tree.rootNode.hasError).toBe(false);
    expect(parsed.content).toHaveLength(source.length);
    expect(parsed.content).toBe('const num1 = 0 ;\nconst num2 = 2 ;\nconst num3 = -0 ;');
  });

  it('preserves line count and byte offsets across every sanitizer stage', () => {
    const source = "@Component\nstruct A {\n  build(){\n    Text('😀')\n  }\n}\n";

    for (const stage of ['light', 'brace', 'opaque'] as const) {
      const sanitized = sanitizeArktsForParseFallback(source, stage);
      expect(sanitized).toHaveLength(source.length);
      expect(sanitized.split('\n')).toHaveLength(source.split('\n').length);
    }

    const opaque = maskArktsOpaque(source);
    expect(opaque).toHaveLength(source.length);
    expect(opaque.replace(/[ \r\n]/g, '')).toBe('');
    expect(opaque.split('\n')).toHaveLength(source.split('\n').length);
  });
});
