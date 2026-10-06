import { useEffect, useId, useRef, useState } from "react";
import { certificatePemOptions, type CertificateChain } from "../../../shared/pkiPem";
import DropdownChevron from "../common/DropdownChevron";
import "./certificatePemActions.css";

export default function CertificatePemActions({ pem, serial, chain, onFeedback }: {
  pem: string; serial: string; chain?: CertificateChain; onFeedback: (message: string) => void;
}) {
  const [mode, setMode] = useState<"download" | "copy" | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = certificatePemOptions(pem, chain);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setMode(null); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  function close() {
    container.current?.querySelector<HTMLButtonElement>(`[data-pem-action="${mode}"]`)?.focus();
    setMode(null);
  }
  async function exportPem(option: typeof options[number]) {
    if (option.disabled) return;
    const action = mode;
    close();
    try {
      if (action === "copy") {
        await navigator.clipboard.writeText(option.pem);
        onFeedback(`${option.label}: ${option.count} certificate(s) copied to clipboard`);
      } else {
        const url = URL.createObjectURL(new Blob([option.pem], { type: "application/x-pem-file" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${serial.replace(/[^a-zA-Z0-9_-]/g, "-")}-${option.id}.pem`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        onFeedback(`${option.label}: ${option.count} certificate(s) downloaded`);
      }
    } catch { onFeedback(`Could not ${action === "copy" ? "copy" : "download"} PEM. Please try again.`); }
  }
  return <div className="pki-pem-actions" ref={container} onKeyDown={event => {
    if (mode && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    {(["download", "copy"] as const).map(action => <button type="button" key={action}
      data-pem-action={action} aria-expanded={mode === action} aria-controls={id}
      onClick={() => setMode(mode === action ? null : action)}>
      {action === "download" ? "Download PEM" : "Copy PEM"}<DropdownChevron />
    </button>)}
    {mode && <div className="pki-pem-menu" id={id} role="group" aria-label={`${mode === "copy" ? "Copy" : "Download"} PEM options`}>
      <div className="pki-pem-menu-heading">{mode === "copy" ? "Copy PEM" : "Download PEM"}</div>
      {options.map((option, index) => <button type="button" key={option.id}
        className={index === 3 ? "pki-pem-menu-divider" : undefined}
        disabled={option.disabled} onClick={() => void exportPem(option)}>
        <span>{option.label}<small>{option.disabled ? option.reason : option.description}</small></span>
        {!option.disabled && <small className="pki-pem-count">{option.count} {option.count === 1 ? "cert" : "certs"}</small>}
      </button>)}
    </div>}
  </div>;
}
