import { useState } from 'react';
import { Link } from 'react-router-dom';

interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  copyPath?: string;
}

export default function Breadcrumb({ items, copyPath }: BreadcrumbProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!copyPath) return;
    void navigator.clipboard.writeText(copyPath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <nav className="flex items-center gap-1 text-sm text-gray-500">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="mx-1">/</span>}
          {item.path ? (
            <Link to={item.path} className="text-[#1563ff] hover:text-[#1250d4] hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-800 font-medium">{item.label}</span>
          )}
        </span>
      ))}
      {copyPath && (
        <button
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy path'}
          className="ml-1 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-600"
        >
          {copied ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 000 4h6a2 2 0 000-4M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          )}
        </button>
      )}
    </nav>
  );
}

