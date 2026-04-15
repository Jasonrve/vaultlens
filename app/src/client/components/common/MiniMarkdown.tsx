import React from 'react';

interface MiniMarkdownProps {
  content: string;
}

/**
 * Lightweight Markdown renderer that handles the subset used in
 * developer integration guides:
 *   - # / ## / ### headings
 *   - ``` fenced code blocks with optional language
 *   - **bold**, `inline-code`, [text](url) links
 *   - - bullet list items
 *   - | table rows (header + data)
 *   - > blockquotes
 *   - Blank lines as paragraph separators
 */
export default function MiniMarkdown({ content }: MiniMarkdownProps) {
  const nodes = parse(content);
  return <div className="prose-mini">{nodes}</div>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'paragraph'; text: string }
  | { type: 'hr' };

// ── Parser ────────────────────────────────────────────────────────────────────

function parse(md: string): React.ReactNode[] {
  const lines = md.split('\n');
  const blocks: Block[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
      continue;
    }

    // Headings
    const h1 = line.match(/^# (.+)/);
    if (h1) { blocks.push({ type: 'heading', level: 1, text: h1[1] }); i++; continue; }
    const h2 = line.match(/^## (.+)/);
    if (h2) { blocks.push({ type: 'heading', level: 2, text: h2[1] }); i++; continue; }
    const h3 = line.match(/^### (.+)/);
    if (h3) { blocks.push({ type: 'heading', level: 3, text: h3[1] }); i++; continue; }

    // HR
    if (/^---+$/.test(line.trim())) { blocks.push({ type: 'hr' }); i++; continue; }

    // Blockquote
    if (/^> /.test(line)) {
      blocks.push({ type: 'blockquote', text: line.replace(/^> /, '') });
      i++;
      continue;
    }

    // List
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*] /, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Table (starts with |)
    if (/^\|/.test(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      const parsed = parseTable(tableLines);
      if (parsed) blocks.push(parsed);
      continue;
    }

    // Blank line
    if (line.trim() === '') { i++; continue; }

    // Paragraph — collect contiguous non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,3} /.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^> /.test(lines[i]) &&
      !/^\|/.test(lines[i]) &&
      !/^[-*] /.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
    } else if (i < lines.length && lines[i].trim() !== '') {
      // Safety: line matched no handler and wasn't added — skip to prevent infinite loop
      i++;
    }
  }

  return blocks.map((block, idx) => renderBlock(block, idx));
}

function parseTable(lines: string[]): Block | null {
  if (lines.length < 2) return null;
  const parse = (l: string) =>
    l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const headers = parse(lines[0]);
  // lines[1] is the separator row (---|---|...)
  const rows = lines.slice(2).map(parse);
  return { type: 'table', headers, rows };
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function renderBlock(block: Block, key: number): React.ReactNode {
  switch (block.type) {
    case 'heading': {
      const cls =
        block.level === 1
          ? 'text-xl font-bold text-gray-900 mt-6 mb-3 pb-1 border-b border-gray-200'
          : block.level === 2
            ? 'text-base font-semibold text-gray-800 mt-5 mb-2'
            : 'text-sm font-semibold text-gray-700 mt-4 mb-1';
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';
      return <Tag key={key} className={cls}>{renderInline(block.text)}</Tag>;
    }
    case 'code':
      return (
        <div key={key} className="my-3 rounded-md overflow-hidden border border-gray-200">
          {block.lang && (
            <div className="bg-gray-100 px-3 py-1 text-xs font-mono text-gray-500 border-b border-gray-200">
              {block.lang}
            </div>
          )}
          <pre className="bg-gray-900 text-gray-100 text-xs p-4 overflow-x-auto leading-relaxed">
            <code>{block.text}</code>
          </pre>
        </div>
      );
    case 'ul':
      return (
        <ul key={key} className="my-2 ml-4 list-disc space-y-1">
          {block.items.map((item, i) => (
            <li key={i} className="text-sm text-gray-700">{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'blockquote':
      return (
        <div key={key} className="my-2 pl-3 border-l-4 border-blue-300 bg-blue-50 py-2 pr-3 rounded-r">
          <p className="text-sm text-blue-800 italic">{renderInline(block.text)}</p>
        </div>
      );
    case 'table':
      return (
        <div key={key} className="my-3 overflow-x-auto">
          <table className="min-w-full text-sm border-collapse border border-gray-200 rounded-md overflow-hidden">
            <thead>
              <tr className="bg-gray-50">
                {block.headers.map((h, i) => (
                  <th key={i} className="border border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-gray-200 px-3 py-2 text-gray-700">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'hr':
      return <hr key={key} className="my-4 border-gray-200" />;
    case 'paragraph':
      return (
        <p key={key} className="my-2 text-sm text-gray-700 leading-relaxed">
          {renderInline(block.text)}
        </p>
      );
    default:
      return null;
  }
}

// ── Inline renderer ───────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  // Split on **bold**, `code`, and [text](url)
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-gray-800">
          {part.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return part;
  });
}
