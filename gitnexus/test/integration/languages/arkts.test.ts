import { describe, it, expect, beforeAll } from 'vitest';
import { SupportedLanguages } from 'gitnexus-shared';
import { arktsProvider } from '../../../src/core/ingestion/languages/arkts.js';
import { LANGUAGE_QUERIES } from '../../../src/core/ingestion/tree-sitter-queries.js';
import { loadParser, loadLanguage } from '../../../src/core/tree-sitter/parser-loader.js';
import Parser from 'tree-sitter';

describe('ArkTS Language Provider', () => {
  it('registers .ets extension', () => {
    expect(arktsProvider.extensions).toContain('.ets');
  });

  it('uses ArkTS language ID', () => {
    expect(arktsProvider.id).toBe(SupportedLanguages.ArkTS);
  });

  it('uses ARKTS_QUERIES with tree-sitter-arkts node types', () => {
    // Verify queries use tree-sitter-arkts node types (not TypeScript's)
    expect(LANGUAGE_QUERIES[SupportedLanguages.ArkTS]).toContain('method_declaration');
    expect(LANGUAGE_QUERIES[SupportedLanguages.ArkTS]).toContain('component_declaration');
    expect(LANGUAGE_QUERIES[SupportedLanguages.ArkTS]).toContain('string_literal');
    expect(LANGUAGE_QUERIES[SupportedLanguages.ArkTS]).toContain('variable_declaration');
    // Should NOT contain TypeScript-specific node types
    expect(LANGUAGE_QUERIES[SupportedLanguages.ArkTS]).not.toContain('type_identifier');
    expect(LANGUAGE_QUERIES[SupportedLanguages.ArkTS]).not.toContain('property_identifier');
    expect(LANGUAGE_QUERIES[SupportedLanguages.ArkTS]).not.toContain('method_definition');
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

  it('can load tree-sitter-arkts parser', async () => {
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
    const decorators = tree.rootNode.descendantsOfType('decorator');
    expect(decorators.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ArkTS Query Matching', () => {
  let parser: Parser;

  beforeAll(async () => {
    parser = await loadParser();
    await loadLanguage(SupportedLanguages.ArkTS);
  });

  function queryMatches(code: string) {
    const lang = parser.getLanguage();
    const query = new Parser.Query(lang, arktsProvider.treeSitterQueries);
    const tree = parser.parse(code);
    return query.matches(tree.rootNode);
  }

  function extractNames(matches: any[], captureName: string): string[] {
    const names: string[] = [];
    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === captureName) {
          names.push(capture.node.text);
        }
      }
    }
    return [...new Set(names)];
  }

  function extractDefTypes(matches: any[]): { type: string; name: string }[] {
    const defs: { type: string; name: string }[] = [];
    for (const match of matches) {
      let defType = '';
      let name = '';
      for (const capture of match.captures) {
        if (capture.name.startsWith('definition.')) defType = capture.name;
        if (capture.name === 'name') name = capture.node.text;
      }
      if (defType && name) defs.push({ type: defType, name });
    }
    return defs;
  }

  it('extracts class definitions', () => {
    const matches = queryMatches('class Foo extends Bar {}');
    const defs = extractDefTypes(matches);
    expect(defs).toContainEqual({ type: 'definition.class', name: 'Foo' });
  });

  it('extracts interface definitions', () => {
    const matches = queryMatches('interface User { name: string; }');
    const defs = extractDefTypes(matches);
    expect(defs).toContainEqual({ type: 'definition.interface', name: 'User' });
  });

  it('extracts method definitions', () => {
    const matches = queryMatches('class Foo { build() {} greet(name: string): void {} }');
    const defs = extractDefTypes(matches);
    const methodNames = defs.filter((d) => d.type === 'definition.method').map((d) => d.name);
    expect(methodNames).toContain('build');
    expect(methodNames).toContain('greet');
  });

  it('extracts property definitions', () => {
    const matches = queryMatches('class Foo { name: string = ""; count: number = 0 }');
    const defs = extractDefTypes(matches);
    const propNames = defs.filter((d) => d.type === 'definition.property').map((d) => d.name);
    expect(propNames).toContain('name');
    expect(propNames).toContain('count');
  });

  it('extracts import sources', () => {
    const matches = queryMatches('import { Router } from "@ohos.router";');
    const sources = extractNames(matches, 'import.source');
    expect(sources).toContain('"@ohos.router"');
  });

  it('extracts call names', () => {
    const matches = queryMatches('foo(); console.log("hi"); new Bar();');
    const callNames = extractNames(matches, 'call.name');
    expect(callNames).toContain('foo');
    expect(callNames).toContain('log');
    expect(callNames).toContain('Bar');
  });

  it('extracts arrow function definitions', () => {
    const matches = queryMatches('const fn = (x: number) => x + 1;');
    const defs = extractDefTypes(matches);
    expect(defs).toContainEqual({ type: 'definition.function', name: 'fn' });
  });

  it('extracts heritage (extends and implements)', () => {
    const matches = queryMatches('class Foo extends Bar implements IBaz {}');
    const extendsNames = extractNames(matches, 'heritage.extends');
    const implementsNames = extractNames(matches, 'heritage.implements');
    expect(extendsNames).toContain('Bar');
    expect(implementsNames).toContain('IBaz');
  });

  it('extracts component declarations', () => {
    const matches = queryMatches('@Component struct Index { build() {} }');
    const defs = extractDefTypes(matches);
    const classNames = defs.filter((d) => d.type === 'definition.class').map((d) => d.name);
    expect(classNames).toContain('Index');
  });
});
