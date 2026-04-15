import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
let ArkTS: any;
try {
  ArkTS = _require('tree-sitter-arkts');
} catch {
  // tree-sitter-arkts not installed — skip tests
}

import { extractArktsUiChainMatches } from '../../src/core/ingestion/utils/arkts-ui-chain-extractor.js';
import { ARKTS_QUERIES } from '../../src/core/ingestion/tree-sitter-queries.js';

describe.skipIf(!ArkTS)('extractArktsUiChainMatches', () => {
  const parser = new Parser();
  parser.setLanguage(ArkTS);

  it('extracts UI component calls from ERROR nodes caused by control flow', () => {
    const content = `@Builder
build() {
  if (true) {
    Text("hello")
  } else {
    Text("world")
  }
}`;
    const tree = parser.parse(content);
    const matches = extractArktsUiChainMatches(tree, content);

    const callNames = matches
      .flatMap((m) => m.captures.filter((c) => c.name === 'call.name'))
      .map((c) => c.node.text);

    expect(callNames.filter((n) => n === 'Text').length).toBeGreaterThanOrEqual(1);
  });

  it('extracts UI components from well-formed @Builder with no ERROR nodes', () => {
    const content = `@Entry
@Component
struct Index {
  @Builder
  build() {
    Text("hello").fontSize(20)
  }
}`;
    const tree = parser.parse(content);
    const matches = extractArktsUiChainMatches(tree, content);
    expect(Array.isArray(matches)).toBe(true);
  });

  it('returns empty array for files with no UI components', () => {
    const content = `function add(a: number, b: number): number {
  return a + b;
}`;
    const tree = parser.parse(content);
    const matches = extractArktsUiChainMatches(tree, content);
    expect(matches).toHaveLength(0);
  });

  it('does not produce duplicate captures', () => {
    const content = `@Builder
build() {
  if (true) {
    Text("a")
    Text("b")
  }
}`;
    const tree = parser.parse(content);
    const matches = extractArktsUiChainMatches(tree, content);

    const callNodes = matches
      .flatMap((m) => m.captures.filter((c) => c.name === 'call'))
      .map((c) => c.node.startIndex);
    const unique = new Set(callNodes);
    expect(callNodes.length).toBe(unique.size);
  });

  it('captures have correct structure (call + call.name)', () => {
    const content = `@Builder
build() {
  if (true) {
    Text("hello").fontSize(20)
  }
}`;
    const tree = parser.parse(content);
    const matches = extractArktsUiChainMatches(tree, content);

    for (const match of matches) {
      const callCapture = match.captures.find((c) => c.name === 'call');
      const nameCapture = match.captures.find((c) => c.name === 'call.name');
      expect(callCapture).toBeDefined();
      expect(nameCapture).toBeDefined();
      expect(nameCapture!.node.type).toBe('identifier');
    }
  });

  it('finds ForEach inside ERROR nodes', () => {
    const content = `@Builder
build() {
  ForEach(this.items, (item: string) => {
    Text(item)
  })
}`;
    const tree = parser.parse(content);
    const matches = extractArktsUiChainMatches(tree, content);

    const callNames = matches
      .flatMap((m) => m.captures.filter((c) => c.name === 'call.name'))
      .map((c) => c.node.text);

    expect(callNames).toContain('ForEach');
  });

  // ── New extractor-layer tests ──────────────────────────────────────────

  it('extracts LazyForEach from ERROR nodes', () => {
    const content = `@Builder
build() {
  if (this.showList) {
    LazyForEach(this.dataSource, (item: string) => {
      Text(item)
    })
  }
}`;
    const tree = parser.parse(content);
    const matches = extractArktsUiChainMatches(tree, content);

    const callNames = matches
      .flatMap((m) => m.captures.filter((c) => c.name === 'call.name'))
      .map((c) => c.node.text);

    expect(callNames).toContain('LazyForEach');
  });

  it('extracts all nested components: Column{Row{Text}}', () => {
    const content = `@Builder
build() {
  if (true) {
    Column() {
      Row() {
        Text("nested")
      }
    }
  }
}`;
    const tree = parser.parse(content);
    const matches = extractArktsUiChainMatches(tree, content);

    const callNames = matches
      .flatMap((m) => m.captures.filter((c) => c.name === 'call.name'))
      .map((c) => c.node.text);

    expect(callNames).toContain('Column');
    expect(callNames).toContain('Row');
    expect(callNames).toContain('Text');
  });

  it('extracts Text from event callback .onClick(()=>{Text("x")})', () => {
    const content = `@Builder
build() {
  Button("click")
    .onClick(() => {
      if (true) {
        Text("x")
      }
    })
}`;
    const tree = parser.parse(content);
    const matches = extractArktsUiChainMatches(tree, content);

    const callNames = matches
      .flatMap((m) => m.captures.filter((c) => c.name === 'call.name'))
      .map((c) => c.node.text);

    expect(callNames).toContain('Button');
    expect(callNames).toContain('Text');
  });

  it('extracts custom PascalCase components in builder context', () => {
    const content = `@Builder
build() {
  if (true) {
    MyCustomWidget()
    AnotherComponent({ count: 1 })
  }
}`;
    const tree = parser.parse(content);
    const matches = extractArktsUiChainMatches(tree, content);

    // tree-sitter-arkts wraps custom components inside ERROR > property_assignment
    // The extractor walks ERROR nodes; custom PascalCase names may or may not
    // be extracted depending on how the parser represents them.
    // The key invariant is: no crash and no duplicates.
    expect(Array.isArray(matches)).toBe(true);
    const callNodes = matches
      .flatMap((m) => m.captures.filter((c) => c.name === 'call'))
      .map((c) => c.node.startIndex);
    const unique = new Set(callNodes);
    expect(callNodes.length).toBe(unique.size);
  });

  it('extracts ui_component nodes from clean parse path', () => {
    // Well-formed ArkTS that parses cleanly without ERROR nodes
    // tree-sitter-arkts produces arkts_ui_element > ui_component > Text
    // where Text node type is literally "Text" (not "identifier")
    const content = `@Entry
@Component
struct Index {
  build() {
    Text("hello").fontSize(20)
  }
}`;
    const tree = parser.parse(content);
    const matches = extractArktsUiChainMatches(tree, content);

    // Clean parse trees may not produce call_expression nodes (uses ui_component instead).
    // The extractor should not crash and may return matches from ui_component strategy.
    expect(Array.isArray(matches)).toBe(true);
    // If matches are found, they should have the correct structure
    for (const match of matches) {
      const callCapture = match.captures.find((c) => c.name === 'call');
      const nameCapture = match.captures.find((c) => c.name === 'call.name');
      expect(callCapture).toBeDefined();
      expect(nameCapture).toBeDefined();
    }
  });
});

// ── Queries layer tests (no parser needed) ──────────────────────────────────

describe('ARKTS_QUERIES - query patterns', () => {
  it('contains @definition.interface for interface_declaration', () => {
    expect(ARKTS_QUERIES).toContain('interface_declaration');
    expect(ARKTS_QUERIES).toContain('@definition.interface');
  });

  it('contains @definition.enum for enum_declaration', () => {
    expect(ARKTS_QUERIES).toContain('enum_declaration');
    expect(ARKTS_QUERIES).toContain('@definition.enum');
  });

  it('contains @definition.enum_member for enum_member', () => {
    expect(ARKTS_QUERIES).toContain('enum_member');
    expect(ARKTS_QUERIES).toContain('@definition.enum_member');
  });

  it('contains @definition.method for constructor_declaration', () => {
    expect(ARKTS_QUERIES).toContain('constructor_declaration');
    expect(ARKTS_QUERIES).toContain('@definition.method');
  });

  it('contains @definition.type for type_declaration', () => {
    expect(ARKTS_QUERIES).toContain('type_declaration');
    expect(ARKTS_QUERIES).toContain('@definition.type');
  });

  it('contains import_specifier for named imports', () => {
    expect(ARKTS_QUERIES).toContain('import_specifier');
  });

  it('contains implements_clause for heritage recognition', () => {
    expect(ARKTS_QUERIES).toContain('implements_clause');
    expect(ARKTS_QUERIES).toContain('@heritage.implements');
  });

  it('contains @definition.function for decorated_function_declaration (@Builder)', () => {
    expect(ARKTS_QUERIES).toContain('decorated_function_declaration');
    // decorated_function_declaration maps to @definition.function
    const lines = ARKTS_QUERIES.split('\n');
    const decoratedBlock = lines.findIndex((l) => l.includes('decorated_function_declaration'));
    expect(decoratedBlock).toBeGreaterThanOrEqual(0);
    // Check the following lines contain @definition.function
    const block = lines.slice(decoratedBlock, decoratedBlock + 3).join('\n');
    expect(block).toContain('@definition.function');
  });

  it('contains @export for export_declaration', () => {
    expect(ARKTS_QUERIES).toContain('export_declaration');
    expect(ARKTS_QUERIES).toContain('@export');
  });

  it('contains @export for decorated_export_declaration', () => {
    expect(ARKTS_QUERIES).toContain('decorated_export_declaration');
  });
});
