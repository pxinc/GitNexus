/**
 * ArkTS language provider.
 *
 * ArkTS is a superset of TypeScript used in HarmonyOS UI development.
 * Uses tree-sitter-arkts (requires tree-sitter 0.25+ ABI).
 * tree-sitter-arkts natively parses ArkTS-specific syntax including
 * `struct` declarations, `@Component`/`@State` decorators, and
 * `build()` methods — no more ERROR nodes for struct-style components.
 */

import { SupportedLanguages } from 'gitnexus-shared';
import type { NodeLabel } from 'gitnexus-shared';
import { defineLanguage } from '../language-provider.js';
import { createClassExtractor } from '../class-extractors/generic.js';
import type { ClassExtractionConfig } from '../class-types.js';
import type { SyntaxNode } from '../utils/ast-helpers.js';
import { typeConfig as typescriptConfig } from '../type-extractors/typescript.js';
import { tsExportChecker } from '../export-detection.js';
import { resolveTypescriptImport } from '../import-resolvers/standard.js';
import { extractTsNamedBindings } from '../named-bindings/typescript.js';
import { ARKTS_QUERIES } from '../tree-sitter-queries.js';
import { typescriptFieldExtractor } from '../field-extractors/typescript.js';
import { createMethodExtractor } from '../method-extractors/generic.js';
import { typescriptMethodConfig } from '../method-extractors/configs/typescript-javascript.js';
import { BUILT_INS } from './typescript.js';

/**
 * ArkTS UI component names recognized by the builtInNames set.
 * These are standard HarmonyOS declarative UI components that should
 * not produce CALLS edges in the knowledge graph.
 */
export const ARKTS_UI_COMPONENTS: ReadonlySet<string> = new Set([
  // Basic components
  'Text',
  'Button',
  'Image',
  'TextInput',
  'TextArea',
  'Slider',
  'Toggle',
  'Radio',
  'Checkbox',
  // Layout components
  'Column',
  'Row',
  'Stack',
  'Flex',
  'Grid',
  'Scroll',
  'List',
  'ListItem',
  'Tabs',
  'TabContent',
  // Navigation & container
  'Swiper',
  'Navigator',
  'Web',
  // Control flow
  'ForEach',
  'If',
]);

const arktsClassConfig: ClassExtractionConfig = {
  language: SupportedLanguages.ArkTS,
  // tree-sitter-arkts natively parses component_declaration and struct_declaration
  typeDeclarationNodes: [
    'class_declaration',
    'abstract_class_declaration',
    'interface_declaration',
    'enum_declaration',
    'component_declaration',
    'struct_declaration',
  ],
  ancestorScopeNodeTypes: [
    'class_declaration',
    'abstract_class_declaration',
    'interface_declaration',
    'enum_declaration',
    'component_declaration',
    'struct_declaration',
  ],
};

/**
 * ArkTS: arrow_function and function_expression get their name from
 * the parent variable_declarator (same as TypeScript).
 */
const arktsExtractFunctionName = (
  node: SyntaxNode,
): { funcName: string | null; label: NodeLabel } | null => {
  if (node.type !== 'arrow_function' && node.type !== 'function_expression') return null;

  const parent = node.parent;
  if (parent?.type !== 'variable_declarator') return null;

  let nameNode = parent.childForFieldName?.('name');
  if (!nameNode) {
    for (let i = 0; i < parent.childCount; i++) {
      const c = parent.child(i);
      if (c?.type === 'identifier') {
        nameNode = c;
        break;
      }
    }
  }
  return { funcName: nameNode?.text ?? null, label: 'Function' };
};

export const arktsProvider = defineLanguage({
  id: SupportedLanguages.ArkTS,
  extensions: ['.ets'],
  treeSitterQueries: ARKTS_QUERIES,
  typeConfig: typescriptConfig,
  exportChecker: tsExportChecker,
  importResolver: resolveTypescriptImport,
  namedBindingExtractor: extractTsNamedBindings,
  fieldExtractor: typescriptFieldExtractor,
  methodExtractor: createMethodExtractor({
    ...typescriptMethodConfig,
    extractFunctionName: arktsExtractFunctionName,
  }),
  classExtractor: createClassExtractor(arktsClassConfig),
  builtInNames: new Set([...BUILT_INS, ...ARKTS_UI_COMPONENTS]),
});
