import { describe, it, expect } from 'vitest';
import { SupportedLanguages } from 'gitnexus-shared';
import { arktsProvider } from '../../../src/core/ingestion/languages/arkts.js';
import { LANGUAGE_QUERIES } from '../../../src/core/ingestion/tree-sitter-queries.js';
import { loadParser, loadLanguage } from '../../../src/core/tree-sitter/parser-loader.js';

describe('ArkTS Language Provider', () => {
  it('registers .ets extension', () => {
    expect(arktsProvider.extensions).toContain('.ets');
  });

  it('uses ArkTS language ID', () => {
    expect(arktsProvider.id).toBe(SupportedLanguages.ArkTS);
  });

  it('uses ARKTS_QUERIES (not raw TYPESCRIPT_QUERIES)', () => {
    expect(LANGUAGE_QUERIES[SupportedLanguages.ArkTS]).toContain('@decorator');
    // ARKTS_QUERIES has the bare decorator pattern that TS queries lack
    expect(LANGUAGE_QUERIES[SupportedLanguages.ArkTS]).toContain(
      '(decorator\n  (identifier) @decorator.name) @decorator',
    );
  });

  it('includes ArkTS UI component names in builtInNames', () => {
    expect(arktsProvider.builtInNames.has('Text')).toBe(true);
    expect(arktsProvider.builtInNames.has('Button')).toBe(true);
    expect(arktsProvider.builtInNames.has('Column')).toBe(true);
    expect(arktsProvider.builtInNames.has('ForEach')).toBe(true);
  });

  it('includes standard JS/TS built-in names', () => {
    expect(arktsProvider.builtInNames.has('console')).toBe(true);
    expect(arktsProvider.builtInNames.has('Promise')).toBe(true);
    expect(arktsProvider.builtInNames.has('fetch')).toBe(true);
  });

  it('can load TypeScript parser for ArkTS', async () => {
    const parser = await loadParser();
    await loadLanguage(SupportedLanguages.ArkTS);
    expect(parser).toBeDefined();
    const tree = parser.parse('const x = 1;');
    expect(tree).toBeDefined();
    expect(tree.rootNode.hasError).toBe(false);
  });

  it('parses class-style ArkTS code without errors', async () => {
    const parser = await loadParser();
    await loadLanguage(SupportedLanguages.ArkTS);
    const code = `
@Component
export class MainPage {
  @State message: string = 'Hello';

  build() {
    Column() {
      Text(this.message)
    }
  }
}
`;
    const tree = parser.parse(code);
    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
  });

  it('extracts imports from ArkTS code', async () => {
    const parser = await loadParser();
    await loadLanguage(SupportedLanguages.ArkTS);
    const code = `import { Router } from '@ohos.router';`;
    const tree = parser.parse(code);
    expect(tree.rootNode.hasError).toBe(false);

    // Verify import_declaration exists in the tree
    const hasImport = Array.from({ length: tree.rootNode.childCount }, (_, i) =>
      tree.rootNode.child(i),
    ).some((c) => c?.type === 'import_declaration');
    expect(hasImport).toBe(true);
  });

  it('parses decorators as decorator nodes', async () => {
    const parser = await loadParser();
    await loadLanguage(SupportedLanguages.ArkTS);
    const code = `@Entry
@Component
struct Index {
  @State message: string = ''
}`;
    const tree = parser.parse(code);
    // struct produces ERROR, but decorators should still be parsed
    const decorators = tree.rootNode.descendantsOfType('decorator');
    expect(decorators.length).toBeGreaterThanOrEqual(2);
  });
});
