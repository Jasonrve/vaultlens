import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  templateVars: Record<string, string>;
}

interface Suggestion {
  key: string;
  value: string;
  label: string;
}

export default function MarkdownEditorWithIntellisense({ value, onChange, templateVars }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [suggestionPos, setSuggestionPos] = useState<{ top: number; left: number } | null>(null);

  // Convert templateVars to sorted suggestion list (all vars available)
  const allSuggestions: Suggestion[] = Object.entries(templateVars)
    .map(([key, val]) => ({
      key,
      value: val,
      label: `{{${key}}}`,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  // Handle textarea input
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    const textarea = e.currentTarget;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = newValue.slice(0, cursorPos);

    // Find the last {{ before cursor that hasn't been closed yet
    const lastBracePos = textBeforeCursor.lastIndexOf('{{');
    const lastCloseBrace = textBeforeCursor.lastIndexOf('}}');

    if (lastBracePos !== -1 && lastBracePos > lastCloseBrace) {
      const search = newValue.slice(lastBracePos + 2, cursorPos);

      if (!search.includes('}}')) {
        const filtered = allSuggestions.filter(
          (s) => search === '' || s.key.toLowerCase().includes(search.toLowerCase()),
        );

        if (filtered.length > 0) {
          // Position dropdown near the cursor line, not below the textarea
          const rect = textarea.getBoundingClientRect();
          const lineNumber = textBeforeCursor.split('\n').length - 1;
          const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight) || 20;
          const cursorLineTop = rect.top + lineHeight * (lineNumber + 1);
          
          setSuggestions(filtered);
          setSelectedIndex(0);
          setSuggestionPos({ top: cursorLineTop + 4, left: rect.left });
          setShowSuggestions(true);
        } else {
          setShowSuggestions(false);
        }
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  };

  // Handle keyboard navigation in suggestions
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        selectSuggestion(suggestions[selectedIndex]);
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
      default:
        break;
    }
  };

  // Insert selected suggestion
  const selectSuggestion = (suggestion: Suggestion) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const textAfterCursor = value.slice(cursorPos);

    // Find the {{ before cursor
    const lastBracePos = textBeforeCursor.lastIndexOf('{{');
    if (lastBracePos === -1) return;

    // Replace from {{ to cursor position with the full template var
    const newValue =
      value.slice(0, lastBracePos) +
      suggestion.label +
      textAfterCursor;

    onChange(newValue);
    setShowSuggestions(false);

    // Focus textarea and set cursor after the inserted text
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = lastBracePos + suggestion.label.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative">
      {/* Help text at top */}
      <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3">
        <p className="text-sm text-blue-900">
          <span className="font-semibold">💡 Tip:</span> Type <code className="bg-blue-100 px-1 py-0.5 font-mono text-xs">&#123;&#123;</code> and start typing to see available
          placeholders. Press <code className="bg-blue-100 px-1 py-0.5 font-mono text-xs">Enter</code> or{' '}
          <code className="bg-blue-100 px-1 py-0.5 font-mono text-xs">Tab</code> to select, or <code className="bg-blue-100 px-1 py-0.5 font-mono text-xs">Esc</code> to dismiss.
        </p>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        className="w-full rounded-md border border-gray-300 bg-white p-3 font-mono text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        style={{ minHeight: 480, resize: 'vertical' }}
        spellCheck={false}
      />

      {/* Intellisense suggestions dropdown — compact VS Code style */}
      {showSuggestions && suggestionPos && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="fixed z-50 max-h-64 overflow-y-auto rounded border border-gray-300 bg-white shadow-lg"
          style={{
            top: `${suggestionPos.top}px`,
            left: `${suggestionPos.left}px`,
            width: 'fit-content',
            maxWidth: '60vw',
          }}
        >
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion.key}
              onMouseDown={(e) => {
                e.preventDefault();
                selectSuggestion(suggestion);
              }}
              className={`cursor-pointer flex items-center justify-between gap-4 px-3 py-1.5 text-xs font-mono transition-colors ${
                index === selectedIndex
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
              title={`${suggestion.label} = ${suggestion.value}`}
            >
              <span className="flex-shrink-0">{suggestion.label}</span>
              <span className={`truncate text-right ${index === selectedIndex ? 'text-blue-100' : 'text-gray-400'}`}>
                {suggestion.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Available replacements summary */}
      <p className="mt-2 text-xs text-gray-500">
        Available: <code className="bg-gray-100 px-1 py-0.5 font-mono text-xs">VAULT_ADDR</code>,{' '}
        <code className="bg-gray-100 px-1 py-0.5 font-mono text-xs">MOUNT_PATH</code>,{' '}
        <code className="bg-gray-100 px-1 py-0.5 font-mono text-xs">ROLE_NAME</code>,{' '}
        <code className="bg-gray-100 px-1 py-0.5 font-mono text-xs">AUTH_TYPE</code>,{' '}
        <code className="bg-gray-100 px-1 py-0.5 font-mono text-xs">TOKEN_POLICIES</code> + auth-type-specific vars
      </p>
    </div>
  );
}
