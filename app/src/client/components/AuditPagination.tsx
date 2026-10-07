export function AuditPageSize({
  size,
  onChange,
}: {
  size: number;
  onChange: (size: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-600">
      Per page
      <select
        className="rounded border border-slate-200 bg-white px-2 py-1"
        value={size}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {[10, 25, 50, 100, 500].map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );
}
export default function AuditPagination({
  page,
  total,
  size,
  onChange,
  onSizeChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (page: number) => void;
  onSizeChange?: (size: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 py-3 text-xs text-slate-600">
      {onSizeChange && (
        <AuditPageSize
          size={size}
          onChange={(value) => {
            onSizeChange(value);
            onChange(1);
          }}
        />
      )}
      <span>
        {total ? (page - 1) * size + 1 : 0}–{Math.min(page * size, total)} of{' '}
        {total}
      </span>
      <button
        type="button"
        className="rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-40"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <button
        type="button"
        className="rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-40"
        disabled={page * size >= total}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
