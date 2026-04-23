/**
 * A compact custom combobox that shows a keyboard-navigable dropdown of
 * suggestions as the user types. Used for policy path inputs and webhook
 * audit-field filter values.
 *
 * Props:
 *   value / onChange  — controlled text value
 *   suggestions       — full list of possible options
 *   placeholder       — input placeholder
 *   className         — optional class for the wrapper div
 *   inputClassName    — optional extra class for the <input>
 *   enginePathMode    — when true, filters engine-root suggestions until the
 *                       first "/" is typed, then filters full sub-path options
 */
import { useState, useRef, useEffect } from 'react';

interface SuggestionsComboboxProps {
  value: string;
  onChange: (val: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  /** Filter to engine prefixes before first "/", full paths after */
  enginePathMode?: boolean;
}

function getFilteredSuggestions(
  input: string,
  suggestions: string[],
  enginePathMode: boolean,
): string[] {
  const q = input.toLowerCase();

  if (enginePathMode && !q.includes('/')) {
    // Before first slash: show unique engine-root entries (e.g. "kv/", "secret/")
    // that start with the typed prefix
    const seen = new Set<string>();
    const roots: string[] = [];
    for (const s of suggestions) {
      const slashIdx = s.indexOf('/');
      const root = slashIdx === -1 ? s + '/' : s.slice(0, slashIdx + 1);
      if (!seen.has(root) && root.toLowerCase().startsWith(q)) {
        seen.add(root);
        roots.push(root);
      }
    }
    return roots.slice(0, 12);
  }

  // After slash or plain mode: prefix-match on full suggestions
  return suggestions
    .filter((s) => s.toLowerCase().startsWith(q) && s.toLowerCase() !== q)
    .slice(0, 14);
}

export default function SuggestionsCombobox({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  inputClassName,
  enginePathMode = false,
}: SuggestionsComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = getFilteredSuggestions(value, suggestions, enginePathMode);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0 && filtered[activeIdx]) {
      e.preventDefault();
      onChange(filtered[activeIdx]);
      setOpen(false);
      setActiveIdx(-1);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ''}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActiveIdx(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClassName}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-0.5 max-h-52 w-full min-w-[180px] overflow-auto rounded-md border border-gray-200 bg-white py-0.5 shadow-lg">
          {filtered.map((s, i) => (
            <li
              key={s}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(s);
                setOpen(false);
                setActiveIdx(-1);
              }}
              className={`cursor-pointer px-3 py-1.5 font-mono text-xs ${
                i === activeIdx
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
