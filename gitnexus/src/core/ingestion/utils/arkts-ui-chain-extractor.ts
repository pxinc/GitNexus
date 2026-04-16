/**
 * ArkTS UI chain extractor — recovers call/reference information from
 * ArkTS UI files that contain ERROR nodes due to tree-sitter-arkts limitations.
 *
 * tree-sitter-arkts has partial support for ArkTS UI syntax. Well-formed code
 * like `Text('hello').fontSize(20)` inside a `@Builder` body parses cleanly
 * as `arkts_ui_element > ui_component`. But control flow constructs (if/else,
 * ForEach, etc.) inside builder bodies cause ERROR nodes, and the UI component
 * calls inside those ERROR regions are missed by tree-sitter queries.
 *
 * Inside ERROR nodes, tree-sitter-arkts typically produces:
 *   - `property_name > identifier(Text)` for UI component names
 *   - `expression_statement > expression > call_expression` or similar
 *   - `statement > expression_statement > expression` for standalone calls
 *
 * This extractor walks ERROR nodes to find these patterns and emits synthetic
 * query matches with @call and @call.name captures, matching the format
 * that parse-worker.ts expects.
 */

import type Parser from 'tree-sitter';
import { ARKTS_UI_COMPONENTS } from '../languages/arkts.js';
import type { SyntaxNode } from './ast-helpers.js';

/** Extended set: built-in components + commonly missed ones like LazyForEach */
const BUILT_IN_UI_COMPONENTS: ReadonlySet<string> = new Set([
  ...ARKTS_UI_COMPONENTS,
  'LazyForEach',
]);

/**
 * A synthetic query match that mimics the structure of tree-sitter Query matches.
 */
export interface SyntheticMatch {
  pattern: number;
  captures: { name: string; node: SyntaxNode }[];
}

/**
 * Collect all ERROR nodes in the tree.
 */
function collectErrorNodes(root: SyntaxNode): SyntaxNode[] {
  const errors: SyntaxNode[] = [];

  const walk = (node: SyntaxNode) => {
    if (node.type === 'ERROR') {
      errors.push(node);
      return; // don't recurse into ERROR children — handled by processErrorNode
    }
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  };

  walk(root);
  return errors;
}

/**
 * Try to find a UI component identifier inside an ERROR node or its descendants.
 * Returns the identifier node if found, null otherwise.
 *
 * Looks for these patterns inside ERROR nodes:
 * 1. `property_name > identifier(Text)` — UI component parsed as property name
 * 2. `identifier(Text)` at top level of ERROR — bare UI component name
 * 3. `call_expression > identifier(Text)` — direct call
 * 4. `expression > call_expression` — call inside expression wrapper
 * 5. `statement > expression_statement > expression > call_expression` — statement wrapping
 */
function findUiComponentInError(errorNode: SyntaxNode): SyntaxNode | null {
  // Pattern 1: property_name > identifier (most common in ArkTS ERROR nodes)
  // e.g., ERROR > property_name > identifier("Text")
  for (let i = 0; i < errorNode.childCount; i++) {
    const child = errorNode.child(i);
    if (child.type === 'property_name') {
      const ident = child.childForFieldName?.('name') ?? findChildOfType(child, 'identifier');
      if (ident && BUILT_IN_UI_COMPONENTS.has(idText(ident))) {
        return ident;
      }
    }
  }

  // Pattern 2: direct identifier child of ERROR that is a UI component
  for (let i = 0; i < errorNode.childCount; i++) {
    const child = errorNode.child(i);
    if (child.type === 'identifier' && BUILT_IN_UI_COMPONENTS.has(idText(child))) {
      return child;
    }
  }

  // Pattern 3-5: look deeper for call_expression or identifier in descendants
  const found = findDescendantUiComponent(errorNode);
  if (found) return found;

  return null;
}

/**
 * Find a call_expression or identifier that represents a UI component
 * anywhere in the subtree (limited depth to avoid O(n²) on large ERROR nodes).
 */
function findDescendantUiComponent(node: SyntaxNode): SyntaxNode | null {
  const MAX_DEPTH = 6;
  let depth = 0;

  const walk = (n: SyntaxNode): SyntaxNode | null => {
    if (depth > MAX_DEPTH) return null;
    depth++;

    // Check for call_expression with UI component as function
    if (n.type === 'call_expression') {
      const func = getCallFunctionIdentifier(n);
      if (func && BUILT_IN_UI_COMPONENTS.has(idText(func))) {
        return func;
      }
    }

    // Check for bare identifier that's a UI component
    if (n.type === 'identifier' && BUILT_IN_UI_COMPONENTS.has(n.text)) {
      return n;
    }

    // Recurse
    for (let i = 0; i < n.childCount; i++) {
      const result = walk(n.child(i));
      if (result) return result;
    }

    depth--;
    return null;
  };

  return walk(node);
}

/**
 * Find the nearest ancestor (or self) that looks like a call site for the
 * given UI component identifier. Walks up to find expression_statement or
 * call_expression wrapping the identifier.
 */
function findCallSiteForIdentifier(identNode: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = identNode.parent;

  while (current) {
    if (
      current.type === 'expression_statement' ||
      current.type === 'statement' ||
      current.type === 'call_expression' ||
      current.type === 'property_assignment'
    ) {
      return current;
    }
    // Don't go too far up
    if (
      current.type === 'block_statement' ||
      current.type === 'ERROR' ||
      current.type === 'function_declaration' ||
      current.type === 'method_declaration' ||
      current.type === 'source_file'
    ) {
      return current.parent === identNode.parent?.parent ? null : null;
    }
    current = current.parent;
  }

  return null;
}

function findChildOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i).type === type) return node.child(i);
  }
  return null;
}

/**
 * Extract the function name node from a call_expression.
 * ArkTS AST often wraps identifiers in `expression` nodes:
 *   call_expression(expression(identifier), argument_list)
 * So childForFieldName('function') may return an `expression` wrapper.
 * This function unwraps that to get the actual identifier.
 */
function getCallFunctionIdentifier(callNode: SyntaxNode): SyntaxNode | null {
  let func = callNode.childForFieldName?.('function') ?? callNode.child(0);
  // Unwrap expression wrapper
  if (func?.type === 'expression' && func.childCount === 1) {
    func = func.child(0);
  }
  // member_expression: Text('x').fontSize(20)
  if (func?.type === 'member_expression') {
    func = func.childForFieldName?.('object') ?? func.child(0);
    if (func?.type === 'expression' && func.childCount === 1) {
      func = func.child(0);
    }
  }
  if (func?.type === 'identifier') return func;
  return null;
}

/**
 * Check if a node is inside a build() method or @Builder decorated function.
 */
function isInsideBuilderContext(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (
      current.type === 'build_method' ||
      current.type === 'build_body' ||
      current.type === 'arkts_ui_element'
    ) {
      return true;
    }
    if (current.type === 'method_declaration' && hasBuilderDecorator(current)) {
      return true;
    }
    if (current.type === 'function_declaration' && hasBuilderDecorator(current)) {
      return true;
    }
    if (current.type === 'source_file') break;
    current = current.parent;
  }
  return false;
}

function hasBuilderDecorator(node: SyntaxNode): boolean {
  const prev = node.previousNamedSibling;
  if (prev?.type === 'decorator') {
    const ident = findChildOfType(prev, 'identifier');
    if (ident?.text === 'Builder') return true;
    // Also check call-style: @Builder("name")
    const call = findChildOfType(prev, 'call_expression');
    if (call) {
      const f = call.childForFieldName?.('function') ?? call.child(0);
      if (f?.type === 'identifier' && f.text === 'Builder') return true;
    }
  }
  return false;
}

/** Check if a string starts with an uppercase letter (component naming convention) */
function isComponentName(name: string): boolean {
  const trimmed = name.trimStart();
  return trimmed.length > 0 && /^[A-Z]/.test(trimmed);
}

/** Get trimmed identifier text — tree-sitter-arkts identifiers may include leading whitespace */
function idText(node: SyntaxNode): string {
  return node.text.trimStart();
}

/**
 * Process a single ERROR node and extract UI component references.
 */
function processErrorNode(errorNode: SyntaxNode, seen: Set<number>): SyntheticMatch[] {
  const matches: SyntheticMatch[] = [];

  // First, try to find UI component identifiers directly in this ERROR
  const uiIdent = findUiComponentInError(errorNode);
  if (uiIdent && !seen.has(uiIdent.startIndex)) {
    seen.add(uiIdent.startIndex);

    // Find a suitable "call" node — prefer the expression_statement or property_assignment
    // that wraps the identifier, fall back to the ERROR node itself
    let callNode: SyntaxNode | null = null;
    const parent = uiIdent.parent;

    if (parent) {
      // Walk up to find expression_statement or similar
      let current: SyntaxNode | null = parent;
      while (current && current !== errorNode.parent) {
        if (current.type === 'expression_statement' || current.type === 'call_expression') {
          callNode = current;
          break;
        }
        current = current.parent;
      }
    }

    // Use the expression_statement as the call node if found, otherwise the identifier's parent
    if (!callNode) {
      callNode = parent ?? errorNode;
    }

    matches.push({
      pattern: 0,
      captures: [
        { name: 'call', node: callNode },
        { name: 'call.name', node: uiIdent },
      ],
    });
  }

  // Also recurse into non-ERROR children to find nested UI components
  for (let i = 0; i < errorNode.childCount; i++) {
    const child = errorNode.child(i);
    if (child.type === 'ERROR') continue; // handled separately
    if (child.type === 'property_name') {
      // Already handled above
      continue;
    }

    // Look for call_expression descendants
    const nested = findCallExpressionsInSubtree(child, seen);
    matches.push(...nested);
  }

  return matches;
}

/**
 * Find call_expression nodes that reference UI components in a subtree.
 */
function findCallExpressionsInSubtree(node: SyntaxNode, seen: Set<number>): SyntheticMatch[] {
  const matches: SyntheticMatch[] = [];

  if (node.type === 'call_expression' && !seen.has(node.startIndex)) {
    const func = getCallFunctionIdentifier(node);
    if (func) {
      if (BUILT_IN_UI_COMPONENTS.has(idText(func))) {
        seen.add(node.startIndex);
        matches.push({
          pattern: 0,
          captures: [
            { name: 'call', node },
            { name: 'call.name', node: func },
          ],
        });
        return matches; // don't recurse into this call's children
      }
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    matches.push(...findCallExpressionsInSubtree(node.child(i), seen));
  }

  return matches;
}

/**
 * Scan the entire tree for `property_assignment > property_name > identifier(UI_COMPONENT)`.
 * tree-sitter-arkts often represents UI component calls as property assignments
 * (e.g., `ForEach(this.items, ...)` becomes `property_assignment` with `property_name: ForEach`).
 * These are not inside ERROR nodes but are still missed by standard queries.
 */
function findPropertyAssignmentUiCalls(root: SyntaxNode, seen: Set<number>): SyntheticMatch[] {
  const matches: SyntheticMatch[] = [];

  const walk = (node: SyntaxNode) => {
    if (node.type === 'property_assignment') {
      const propName = findChildOfType(node, 'property_name');
      if (propName) {
        const ident =
          propName.childForFieldName?.('name') ?? findChildOfType(propName, 'identifier');
        if (ident && BUILT_IN_UI_COMPONENTS.has(idText(ident)) && !seen.has(ident.startIndex)) {
          seen.add(ident.startIndex);
          matches.push({
            pattern: 0,
            captures: [
              { name: 'call', node },
              { name: 'call.name', node: ident },
            ],
          });
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  };

  walk(root);
  return matches;
}

/**
 * Main entry point: extract synthetic matches for ArkTS UI component chains
 * found inside ERROR nodes or as property assignments.
 *
 * This is additive — it only adds matches that the query phase missed.
 * Callers should deduplicate by checking if a call was already extracted.
 *
 * @param tree - The parsed tree-sitter tree
 * @param _content - The file content (reserved for future regex fallback)
 * @returns Array of synthetic query matches
 */

/**
 * Strategy 4: Find custom (user-defined) component instantiations.
 * These are call_expressions where the function identifier is PascalCase
 * and not in the built-in UI_COMPONENTS set, but is used inside a builder context.
 * Only walks inside builder contexts to limit false positives.
 */
function findCustomComponentCalls(root: SyntaxNode, seen: Set<number>): SyntheticMatch[] {
  const matches: SyntheticMatch[] = [];

  // Find builder context nodes first, then walk inside them.
  // We cannot use isInsideBuilderContext on every node because
  // the root (source_file) is not inside a builder context, which
  // would cause the walk to skip the entire tree.
  const builderContexts: SyntaxNode[] = [];
  const collectBuilderContexts = (node: SyntaxNode) => {
    if (
      node.type === 'build_method' ||
      node.type === 'build_body' ||
      node.type === 'arkts_ui_element'
    ) {
      builderContexts.push(node);
    }
    if (
      (node.type === 'method_declaration' || node.type === 'function_declaration') &&
      hasBuilderDecorator(node)
    ) {
      builderContexts.push(node);
    }
    for (let i = 0; i < node.childCount; i++) {
      collectBuilderContexts(node.child(i));
    }
  };
  collectBuilderContexts(root);

  const walk = (node: SyntaxNode) => {
    if (node.type === 'call_expression' && !seen.has(node.startIndex)) {
      const func = getCallFunctionIdentifier(node);
      if (func && !BUILT_IN_UI_COMPONENTS.has(idText(func)) && isComponentName(idText(func))) {
        seen.add(node.startIndex);
        matches.push({
          pattern: 0,
          captures: [
            { name: 'call', node },
            { name: 'call.name', node: func },
          ],
        });
        return; // don't recurse into this call's arguments
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  };

  for (const ctx of builderContexts) {
    walk(ctx);
  }

  return matches;
}

/**
 * Strategy 5: Find `ui_component > identifier` nodes from clean ArkTS parses.
 * tree-sitter-arkts produces `arkts_ui_element > ui_element_with_modifiers > ui_component > identifier`
 * for well-formed UI code. Custom components here would be missed by all other strategies.
 */
function findUiComponentNodes(root: SyntaxNode, seen: Set<number>): SyntheticMatch[] {
  const matches: SyntheticMatch[] = [];

  const walk = (node: SyntaxNode) => {
    if (node.type === 'ui_component') {
      const ident = findChildOfType(node, 'identifier');
      if (ident && !seen.has(ident.startIndex)) {
        // Accept if it's a built-in or a PascalCase custom component
        const isKnown = BUILT_IN_UI_COMPONENTS.has(idText(ident));
        const isCustom = isComponentName(idText(ident));
        if (isKnown || isCustom) {
          seen.add(ident.startIndex);
          // Use the parent arkts_ui_element or ui_component as the call node
          const callNode =
            node.parent?.type === 'ui_element_with_modifiers'
              ? (node.parent.parent ?? node.parent)
              : (node.parent ?? node);
          matches.push({
            pattern: 0,
            captures: [
              { name: 'call', node: callNode },
              { name: 'call.name', node: ident },
            ],
          });
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  };

  walk(root);
  return matches;
}
export function extractArktsUiChainMatches(tree: Parser.Tree, _content?: string): SyntheticMatch[] {
  const root = tree.rootNode;
  const matches: SyntheticMatch[] = [];
  const seen = new Set<number>();

  // Strategy 1: Walk ERROR nodes
  const errorNodes = collectErrorNodes(root);
  for (const errorNode of errorNodes) {
    matches.push(...processErrorNode(errorNode, seen));
  }

  // Strategy 2: Scan for property_assignment patterns (common in ArkTS parse output)
  matches.push(...findPropertyAssignmentUiCalls(root, seen));

  // Strategy 3: Scan for call_expression nodes with UI components anywhere in the tree
  matches.push(...findCallExpressionsInSubtree(root, seen));

  // Strategy 4: Find custom component call_expressions in builder context.
  // Custom components (e.g., MyWidget) are PascalCase identifiers used as
  // call_expression targets inside build()/@Builder bodies.
  matches.push(...findCustomComponentCalls(root, seen));

  // Strategy 5: Find ui_component nodes (clean parse path for custom components).
  // tree-sitter-arkts produces `arkts_ui_element > ui_component > identifier`
  // for well-formed code. Built-in components are already in UI_COMPONENTS,
  // but custom ones are not and would be missed.
  matches.push(...findUiComponentNodes(root, seen));

  return matches;
}
