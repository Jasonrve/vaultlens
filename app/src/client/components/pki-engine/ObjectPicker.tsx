import { useEffect, useId, useRef, useState } from "react";
import { pkiEngineLookup } from "../../lib/api";
import type { PkiEngineResult } from "../../../shared/pkiEngine";
import DropdownChevron from "../common/DropdownChevron";

/** Live, bounded PKI lookup; known references still work without LIST permission. */
export default function ObjectPicker({
  mount,
  source,
  kind,
  label,
  placeholder,
  value,
  onChange,
}: {
  mount: string;
  source: string;
  kind: "roles" | "issuers";
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(-1);
  const [result, setResult] = useState<PkiEngineResult | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setResult(null);
    setError("");
    setActive(-1);
    const timer = setTimeout(() => {
      void pkiEngineLookup(mount, source, kind, value.trim(), controller.signal)
        .then((r) => {
          if (!controller.signal.aborted) {
            setResult(r);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(e.response?.data?.error || e.message || "Lookup failed");
            setLoading(false);
          }
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, mount, source, kind, value]);
  const items = result?.items || [];
  function select(reference: string) {
    onChange(reference);
    setOpen(false);
    setActive(-1);
  }
  return (
    <div
      className="engine-picker"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <div className="engine-picker-input">
        <input
          ref={input}
          role="combobox"
          className="ui-dropdown-control"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={id}
          aria-activedescendant={
            open && active >= 0 && items[active] ? `${id}-${active}` : undefined
          }
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
            setResult(null);
            setLoading(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              setActive(-1);
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              if (items.length)
                setActive((old) =>
                  e.key === "ArrowDown"
                    ? Math.min(old + 1, items.length - 1)
                    : Math.max(old - 1, 0),
                );
            }
            if (e.key === "Enter" && open) {
              e.preventDefault();
              if (items[active]) select(items[active].id);
              else if (items.length === 1) select(items[0].id);
              else if (value.trim() && !loading) setOpen(false);
            }
          }}
        />
        <button
          type="button"
          aria-label={`Show ${kind}`}
          aria-expanded={open}
          aria-controls={id}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            input.current?.focus();
            setOpen(!open);
          }}
        >
          <DropdownChevron />
        </button>
      </div>
      {open && (
        <div className="engine-picker-panel">
          {loading && <div role="status">Loading {kind}…</div>}
          {error && (
            <div role="alert">
              {error}. You can enter a known{" "}
              {kind === "roles" ? "role name" : "issuer name or ID"}.
            </div>
          )}
          <div role="listbox" id={id} aria-label={label} aria-busy={loading}>
            {items.map((item, index) => {
              const info =
                item.info && typeof item.info === "object"
                  ? (item.info as Record<string, unknown>)
                  : {};
              const name = String(info.issuer_name || item.id);
              return (
                <button
                  type="button"
                  role="option"
                  key={item.id}
                  id={`${id}-${index}`}
                  aria-selected={active === index}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => select(item.id)}
                >
                  {name}
                  {name !== item.id && <small>{item.id}</small>}
                </button>
              );
            })}
          </div>
          {!loading && !error && !items.length && (
            <div role="status">
              No matching {kind}. You can enter a known{" "}
              {kind === "roles" ? "role name" : "issuer name or ID"}.
            </div>
          )}
          {result?.nextOffset != null && (
            <div role="status">
              Showing 50 of {result.total}. Type more to narrow the list.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
