const isIdent = (ch) => !!ch && /[A-Za-z0-9_$]/.test(ch);
const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

function previousNonSpace(source, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (!isSpace(source[i])) return source[i];
  }
  return undefined;
}

function nextNonSpace(source, index) {
  for (let i = index; i < source.length; i++) {
    if (!isSpace(source[i])) return source[i];
  }
  return undefined;
}

function maskRange(chars, start, end) {
  for (let i = start; i < end; i++) {
    if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  }
}

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function hasColonAfter(source, closeIndex) {
  let quote = null;
  let escaped = false;
  for (let i = closeIndex + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === ':') return true;
    if (ch === ';' || ch === '\n' || ch === '\r' || ch === '}') return false;
  }
  return false;
}

export function maskArktsTernaryParens(source) {
  const chars = source.split('');
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '?') continue;

    let j = i + 1;
    while (isSpace(source[j])) j++;
    if (source[j] !== '(') continue;

    const closeIndex = findMatchingParen(source, j);
    if (closeIndex === -1 || !hasColonAfter(source, closeIndex)) continue;

    chars[j] = ' ';
    chars[closeIndex] = ' ';
  }
  return chars.join('');
}

export function maskArktsInvalidNumericLiterals(source) {
  const chars = source.split('');
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    const next = source[i + 1];

    if (ch === '.' && /\d/.test(next ?? '') && !isIdent(prev) && prev !== ')') {
      chars[i] = '0';
      let j = i + 1;
      while (/\d/.test(source[j] ?? '')) {
        chars[j] = ' ';
        j++;
      }
      continue;
    }

    if (ch === '.' && /\d/.test(prev ?? '') && !isIdent(next)) {
      chars[i] = ' ';
    }
  }
  return chars.join('');
}

export function maskArktsAngleAssertions(source) {
  const chars = source.split('');
  const assertion = /<\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\s*\[\s*\])?\s*>/g;
  let match;
  while ((match = assertion.exec(source)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const prev = previousNonSpace(source, start);
    const next = nextNonSpace(source, end);
    if (isIdent(prev) || prev === ']' || prev === ')' || prev === '}') continue;
    if (!next || !/[A-Za-z0-9_$"'([{]/.test(next)) continue;
    maskRange(chars, start, end);
  }
  return chars.join('');
}

export function maskArktsBraceBodies(source) {
  const chars = source.split('');
  const stack = [];
  let quote = null;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      stack.push(i);
      continue;
    }
    if (ch === '}' && stack.length > 0) {
      const open = stack.pop();
      if (open !== undefined && stack.length === 0) {
        maskRange(chars, open + 1, i);
      }
    }
  }

  return chars.join('');
}

export function maskArktsOpaque(source) {
  return source.replace(/[^\r\n]/g, ' ');
}

export function sanitizeArktsForParseFallback(source, stage) {
  const light = maskArktsAngleAssertions(
    maskArktsInvalidNumericLiterals(maskArktsTernaryParens(source)),
  );
  if (stage === 'light') return light;
  const brace = maskArktsBraceBodies(light);
  if (stage === 'brace') return brace;
  return maskArktsOpaque(brace);
}

export function parseArktsWithFallback(parser, source) {
  const raw = parser.parse(source);
  if (!raw.rootNode.hasError) return { tree: raw, content: source, stage: 'raw' };

  const lightContent = sanitizeArktsForParseFallback(source, 'light');
  if (lightContent !== source) {
    const light = parser.parse(lightContent);
    if (!light.rootNode.hasError) return { tree: light, content: lightContent, stage: 'light' };
  }

  const braceContent = sanitizeArktsForParseFallback(source, 'brace');
  if (braceContent !== lightContent) {
    const brace = parser.parse(braceContent);
    if (!brace.rootNode.hasError) return { tree: brace, content: braceContent, stage: 'brace' };
  }

  const opaqueContent = sanitizeArktsForParseFallback(source, 'opaque');
  const opaque = parser.parse(opaqueContent);
  return { tree: opaque, content: opaqueContent, stage: 'opaque' };
}
