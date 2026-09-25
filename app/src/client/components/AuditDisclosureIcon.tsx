import './auditDisclosure.css';

export default function AuditDisclosureIcon({
  level,
}: {
  level: 'group' | 'finding' | 'detail';
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      className={`audit-disclosure-icon audit-disclosure-icon--${level}`}
    >
      {level === 'group' ? (
        <path
          d="m7 4 6 6-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : level === 'finding' ? (
        <>
          <rect
            x="3"
            y="3"
            width="14"
            height="14"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M6 10h8" stroke="currentColor" strokeWidth="1.5" />
          <path
            className="audit-disclosure-plus"
            d="M10 6v8"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </>
      ) : (
        <path d="m6 4 8 6-8 6Z" fill="currentColor" />
      )}
    </svg>
  );
}
