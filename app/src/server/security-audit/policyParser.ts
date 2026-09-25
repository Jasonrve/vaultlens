/** Literal Vault ACL HCL/JSON parser. Lexical parsing preserves comments, offsets and attributes.
 * Expressions outside quoted strings are rejected rather than guessed or evaluated.
 */
export interface PolicyBlock {
  path: string;
  capabilities: string[];
  attributes: Record<string, unknown>;
  line: number;
  column: number;
  source: string;
  leadingComments: string[];
}
export class PolicyParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public column: number,
  ) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'PolicyParseError';
  }
}
interface Token {
  kind: string;
  value: string;
  start: number;
  end: number;
}
export function parsePolicy(source: string): PolicyBlock[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === '\n') starts.push(i + 1);
  function location(at: number) {
    let lo = 0,
      hi = starts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= at) lo = mid;
      else hi = mid;
    }
    return { line: lo + 1, column: at - starts[lo] + 1 };
  }
  function fail(message: string, at: number): never {
    const { line, column } = location(at);
    throw new PolicyParseError(message, line, column);
  }
  let pos = 0;
  function lex(): Token {
    while (pos < source.length) {
      if (/\s/.test(source[pos])) {
        pos++;
        continue;
      }
      if (source[pos] === '#' || source.startsWith('//', pos)) {
        while (pos < source.length && source[pos] !== '\n') pos++;
        continue;
      }
      if (source.startsWith('/*', pos)) {
        const start = pos,
          end = source.indexOf('*/', pos + 2);
        if (end < 0) fail('Unterminated block comment', start);
        pos = end + 2;
        continue;
      }
      break;
    }
    const start = pos;
    if (pos === source.length)
      return { kind: 'eof', value: '', start, end: pos };
    const char = source[pos++];
    if ('{}[]=,:'.includes(char))
      return { kind: char, value: char, start, end: pos };
    if (char === '"') {
      let value = '';
      while (pos < source.length) {
        const c = source[pos++];
        if (c === '"') return { kind: 'string', value, start, end: pos };
        if (c === '\n' || c === '\r') fail('Newline in quoted string', pos - 1);
        if (c !== '\\') {
          value += c;
          continue;
        }
        const escape = source[pos++];
        const simple: Record<string, string> = {
          n: '\n',
          b: '\b',
          f: '\f',
          '/': '/',
          r: '\r',
          t: '\t',
          '"': '"',
          '\\': '\\',
        };
        if (Object.hasOwn(simple, escape)) {
          value += simple[escape];
          continue;
        }
        if (escape === 'u' || escape === 'U') {
          const length = escape === 'u' ? 4 : 8,
            hex = source.slice(pos, pos + length);
          if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex))
            fail('Invalid Unicode escape', pos - 2);
          const code = Number.parseInt(hex, 16);
          if (code > 0x10ffff) fail('Invalid Unicode code point', pos - 2);
          value += String.fromCodePoint(code);
          pos += length;
          continue;
        }
        fail('Invalid string escape', pos - 2);
      }
      fail('Unterminated string', start);
    }
    if (char === '<' && source[pos] === '<') {
      pos++;
      const match = /^(-?)([A-Za-z_][A-Za-z0-9_-]*)[^\S\n]*\r?\n/.exec(
        source.slice(pos),
      );
      if (!match) fail('Invalid heredoc marker', start);
      const indented = match[1] === '-',
        marker = match[2];
      pos += match[0].length;
      const contentStart = pos;
      while (pos < source.length) {
        const newline = source.indexOf('\n', pos),
          end = newline < 0 ? source.length : newline;
        const line = source.slice(pos, end).replace(/\r$/, '');
        if ((indented ? line.trim() : line) === marker) {
          let value = source.slice(contentStart, pos);
          pos = newline < 0 ? end : end + 1;
          if (indented) {
            const lines = value.split('\n'),
              width = Math.min(
                ...lines
                  .filter((l) => l.trim())
                  .map((l) => l.match(/^[ \t]*/)?.[0].length ?? 0),
              );
            if (Number.isFinite(width))
              value = lines
                .map((l) =>
                  l.slice(Math.min(width, l.match(/^[ \t]*/)?.[0].length ?? 0)),
                )
                .join('\n');
          }
          return { kind: 'string', value, start, end: pos };
        }
        pos = newline < 0 ? end : end + 1;
      }
      fail('Unterminated heredoc', start);
    }
    if (/[A-Za-z_]/.test(char)) {
      while (pos < source.length && /[A-Za-z0-9_-]/.test(source[pos])) pos++;
      return {
        kind: 'identifier',
        value: source.slice(start, pos),
        start,
        end: pos,
      };
    }
    if (/[0-9-]/.test(char)) {
      const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
        source.slice(start),
      );
      if (number) {
        pos = start + number[0].length;
        return { kind: 'number', value: number[0], start, end: pos };
      }
    }
    fail('Unsupported token or non-literal expression', start);
  }
  let token = lex();
  function take(kind?: string): Token {
    const current = token;
    if (kind && current.kind !== kind)
      fail(`Expected ${kind}, found ${current.kind}`, current.start);
    token = lex();
    return current;
  }
  function value(depth = 0): unknown {
    if (depth > 64) fail('Maximum literal nesting exceeded', token.start);
    if (token.kind === 'string') return take().value;
    if (token.kind === 'number') {
      const current = take();
      const n = Number(current.value);
      if (!Number.isFinite(n)) fail('Non-finite number', current.start);
      return n;
    }
    if (
      token.kind === 'identifier' &&
      ['true', 'false', 'null'].includes(token.value)
    ) {
      const v = take().value;
      return v === 'null' ? null : v === 'true';
    }
    if (token.kind === '[') {
      take();
      const items: unknown[] = [];
      while (String(token.kind) !== ']') {
        items.push(value(depth + 1));
        if (String(token.kind) === ',') take();
        else if (String(token.kind) !== ']')
          fail('Expected comma between list values', token.start);
      }
      take(']');
      return items;
    }
    if (token.kind === '{') {
      take();
      const obj: Record<string, unknown> = Object.create(null);
      while (String(token.kind) !== '}') {
        if (!['string', 'identifier'].includes(token.kind))
          fail('Expected object key', token.start);
        const key = take();
        if (Object.hasOwn(obj, key.value))
          fail('Duplicate object key', key.start);
        if (!['=', ':'].includes(token.kind))
          fail('Expected object assignment', token.start);
        take();
        obj[key.value] = value(depth + 1);
        if (String(token.kind) === ',') take();
      }
      take('}');
      return obj;
    }
    fail('Expected literal value; expressions are not evaluated', token.start);
  }
  const blocks: PolicyBlock[] = [];
  if (source.trimStart().startsWith('{')) {
    // JSON.parse enforces JSON syntax; the lexer below additionally rejects
    // duplicate keys and preserves source locations for finding evidence.
    try {
      JSON.parse(source);
    } catch {
      fail('Invalid JSON policy', source.search(/\S/));
    }
    const append = (label: Token) => {
      const body = value();
      if (!body || typeof body !== 'object' || Array.isArray(body))
        fail('Expected a JSON path attribute object', label.start);
      const attributes = body as Record<string, unknown>;
      const capabilities = attributes.capabilities;
      if (
        !Array.isArray(capabilities) ||
        !capabilities.length ||
        !capabilities.every((item) => typeof item === 'string')
      )
        fail('A non-empty string capabilities list is required', label.start);
      delete attributes.capabilities;
      blocks.push({
        path: label.value.replace(/^\/+|\/+$/g, ''),
        capabilities: capabilities.map((item) => item.toLowerCase()),
        attributes,
        ...location(label.start),
        source: source.slice(label.start, token.start).trim(),
        leadingComments: [],
      });
    };
    const pathMap = () => {
      take('{');
      const seen = new Set<string>();
      while (String(token.kind) !== '}') {
        const label = take('string');
        if (seen.has(label.value)) fail('Duplicate JSON path key', label.start);
        seen.add(label.value);
        take(':');
        append(label);
        if (String(token.kind) === ',') take();
      }
      take('}');
    };
    take('{');
    let seenPath = false;
    while (String(token.kind) !== '}') {
      const key = take('string');
      if (key.value !== 'path')
        fail('Only path blocks are supported', key.start);
      if (seenPath) fail('Duplicate JSON path declaration', key.start);
      seenPath = true;
      take(':');
      if (String(token.kind) === '[') {
        take('[');
        while (String(token.kind) !== ']') {
          pathMap();
          if (String(token.kind) === ',') take();
        }
        take(']');
      } else pathMap();
      if (String(token.kind) === ',') take();
    }
    take('}');
    take('eof');
    return blocks;
  }
  while (token.kind !== 'eof') {
    if (token.kind === ',') {
      take();
      continue;
    }
    const declaration = take('identifier');
    if (declaration.value !== 'path')
      fail('Only path blocks are supported', declaration.start);
    const label = take('string');
    take('{');
    const body: Record<string, unknown> = Object.create(null);
    while (String(token.kind) !== '}') {
      const key = take('identifier');
      if (Object.hasOwn(body, key.value))
        fail('Duplicate policy attribute', key.start);
      take('=');
      body[key.value] = value();
      if (String(token.kind) === ',') take();
    }
    const end = take('}');
    const capabilities = body.capabilities;
    if (
      !Array.isArray(capabilities) ||
      !capabilities.length ||
      !capabilities.every((c) => typeof c === 'string')
    )
      fail(
        'A non-empty string capabilities list is required',
        declaration.start,
      );
    delete body.capabilities;
    const { line, column } = location(declaration.start);
    const comments: string[] = [];
    if (!source.slice(starts[line - 1], declaration.start).trim()) {
      for (let i = line - 2; i >= 0; i--) {
        const previous = source.slice(starts[i], starts[i + 1]).trim();
        if (previous.startsWith('#'))
          comments.unshift(previous.slice(1).trim());
        else if (previous.startsWith('//'))
          comments.unshift(previous.slice(2).trim());
        else break;
      }
    }
    blocks.push({
      path: label.value.replace(/^\/+|\/+$/g, ''),
      capabilities: capabilities.map((c) => c.toLowerCase()),
      attributes: body,
      line,
      column,
      source: source.slice(declaration.start, end.end).trim(),
      leadingComments: comments,
    });
  }
  return blocks;
}
