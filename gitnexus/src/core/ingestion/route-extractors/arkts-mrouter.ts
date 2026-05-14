// ArkTS MRouter route extraction.
//
// Extracts route definitions from .ets files that use @meituan/mrouter.
// MRouter routes are declared as RouteConfig objects with uri, moduleName,
// type, etc. These are static data declarations (not HTTP routes).

export interface ArkTSRouteConfig {
  uri: string;
  moduleName: string;
  type: string; // "nav" | "page" | "ability" | "handler" | "service"
  filePath: string;
  lineNumber: number;
  packageName?: string;
}

// Quick check: does this file reference mrouter?
const MROUTER_IMPORT_RE = /\bmrouter\b/;

// Match a RouteConfig-like object boundary. We look for uri: "..." as the
// primary signal and extract adjacent properties within the same object.
const URI_PROP_RE = /uri:\s*["']([^"']+)["']/g;
const MODULE_NAME_PROP_RE = /moduleName:\s*["']([^"']+)["']/;
const TYPE_PROP_RE = /type:\s*["']([^"']+)["']/;

/**
 * Extract MRouter route definitions from an ArkTS (.ets) file.
 *
 * Strategy: scan for `uri:` property assignments within objects that
 * resemble RouteConfig. We find each `uri:` occurrence, then search
 * the surrounding ~500 chars for companion properties (moduleName, type).
 */
export function extractArkTSRoutes(filePath: string, content: string): ArkTSRouteConfig[] {
  if (!MROUTER_IMPORT_RE.test(content)) return [];
  MROUTER_IMPORT_RE.lastIndex = 0;

  const routes: ArkTSRouteConfig[] = [];
  let match: RegExpExecArray | null;

  URI_PROP_RE.lastIndex = 0;
  while ((match = URI_PROP_RE.exec(content)) !== null) {
    const uri = match[1];
    const uriEnd = match.index + match[0].length;

    // Search backward for object start ({) and forward for end (}).
    // Use a generous window around the uri property.
    const windowStart = Math.max(0, match.index - 300);
    const windowEnd = Math.min(content.length, uriEnd + 300);
    const window = content.slice(windowStart, windowEnd);

    const moduleNameMatch = MODULE_NAME_PROP_RE.exec(window);
    const typeMatch = TYPE_PROP_RE.exec(window);

    // Compute line number from the uri match position
    const lineNumber = content.slice(0, match.index).split('\n').length;

    routes.push({
      uri,
      moduleName: moduleNameMatch?.[1] ?? '',
      type: typeMatch?.[1] ?? 'nav',
      filePath,
      lineNumber,
    });
  }

  return routes;
}
