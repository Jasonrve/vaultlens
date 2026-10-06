import DropdownChevron from "../common/DropdownChevron";
export default function CertificatePagination({ page, size, total, disabled, onPage, onSize }: {
  page: number; size: number; total: number; disabled: boolean;
  onPage: (page: number) => void; onSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <nav className="pki-pagination" aria-label="Certificate pagination">
      <label>Results per page <select aria-label="Certificates per page" value={size} disabled={disabled} onChange={e => onSize(Number(e.target.value))}>
        {[10, 25, 50, 100, 200].map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <span className="pki-muted" aria-live="polite">{total ? (page - 1) * size + 1 : 0}–{Math.min(page * size, total)} of {total.toLocaleString()}</span>
      <div className="pki-pagination-pages">
        <button aria-label="Previous page" disabled={disabled || page === 1} onClick={() => onPage(page - 1)}><span className="pki-page-previous"><DropdownChevron /></span></button>
        <span className="pki-muted">{page} / {pages}</span>
        <button aria-label="Next page" disabled={disabled || page === pages} onClick={() => onPage(page + 1)}><span className="pki-page-next"><DropdownChevron /></span></button>
      </div>
    </nav>
  );
}
