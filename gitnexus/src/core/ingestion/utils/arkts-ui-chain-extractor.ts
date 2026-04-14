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
      if (ident && ARKTS_UI_COMPONENTS.has(ident.text)) {
        return ident;
      }
    }
  }

  // Pattern 2: direct identifier child of ERROR that is a UI component
  for (let i = 0; i < errorNode.childCount; i++) {
    const child = errorNode.child(i);
    if (child.type === 'identifier' && ARKTS_UI_COMPONENTS.has(child.text)) {
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
      const func = n.childForFieldName?.('function');
      if (func) {
        if (func.type === 'identifier' && ARKTS_UI_COMPONENTS.has(func.text)) {
          return func;
        }
        // member_expression: Text('hello').fontSize(20)
        if (func.type === 'member_expression') {
          const obj = func.childForFieldName?.('object');
          if (obj?.type === 'identifier' && ARKTS_UI_COMPONENTS.has(obj.text)) {
            return obj;
          }
        }
      }
    }

    // Check for bare identifier that's a UI component
    if (n.type === 'identifier' && ARKTS_UI_COMPONENTS.has(n.text)) {
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
    const func = node.childForFieldName?.('function');
    if (func) {
      let nameNode: SyntaxNode | null = null;

      if (func.type === 'identifier' && ARKTS_UI_COMPONENTS.has(func.text)) {
        nameNode = func;
      } else if (func.type === 'member_expression') {
        const obj = func.childForFieldName?.('object');
        if (obj?.type === 'identifier' && ARKTS_UI_COMPONENTS.has(obj.text)) {
          nameNode = obj;
        }
      }

      if (nameNode) {
        seen.add(node.startIndex);
        matches.push({
          pattern: 0,
          captures: [
            { name: 'call', node },
            { name: 'call.name', node: nameNode },
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
        if (ident && ARKTS_UI_COMPONENTS.has(ident.text) && !seen.has(ident.startIndex)) {
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

  return matches;
}
