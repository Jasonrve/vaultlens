import { AxiosError } from "axios";
import { useState } from "react";
import { Link } from "react-router-dom";
import { pkiOperations } from "../../../shared/pkiOperations";
import type { PkiEngineResult } from "../../../shared/pkiEngine";
import * as api from "../../lib/api";
import {
  fieldLabel,
  fieldGroup,
  groupOrder,
  downloadText,
  displayValue,
} from "./fields";

export default function OperationForm({
  action,
  mount,
  source,
  reference,
  initial,
  cancel,
  onSaved,
}: {
  action: string;
  mount: string;
  source: string;
  reference: string;
  initial?: Record<string, unknown>;
  cancel: string;
  onSaved: () => void;
}) {
  const operation = Object.prototype.hasOwnProperty.call(pkiOperations, action)
    ? pkiOperations[action]
    : undefined;
  const [name, setName] = useState(reference),
    [mode, setMode] = useState("internal"),
    [confirm, setConfirm] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      Object.entries(operation?.fields || {})
        .filter(
          ([key]) => initial?.[key] !== undefined && initial?.[key] !== null,
        )
        .map(([key]) => [key, initial![key]]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [response, setResponse] = useState<PkiEngineResult | null>(null);
  if (!operation) return <p role="alert">Unknown operation.</p>;
  const destructive =
    operation.method === "DELETE" ||
    ["issuer-revoke", "certificate-revoke", "tidy-start"].includes(action);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const fields = Object.fromEntries(
        Object.entries(values).map(([key, value]) => {
          const field = operation!.fields[key];
          return [
            key,
            field.type === "array" && typeof value === "string"
              ? value
                  .split(/[,\n]/)
                  .map((v) => v.trim())
                  .filter(Boolean)
              : field.type === "integer"
                ? Number(value)
                : value,
          ];
        }),
      );
      const r = await api.pkiEngineAction({
        mount,
        source,
        action,
        ref: name,
        mode,
        fields,
        confirm,
      });
      setResponse(r);
    } catch (e: unknown) {
      setError(e instanceof AxiosError ? e.response?.data?.error || e.message : e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  if (response)
    return (
      <section className="engine-operation-result">
        <h2>{operation.title}</h2>
        <p role="status">Vault accepted the operation.</p>
        {response.warnings?.map((warning, i) => (
          <p className="engine-notice" key={i}>
            {warning}
          </p>
        ))}
        {!!response.data?.private_key && (
          <p className="engine-notice">
            Download the private key now. It is only available in this response
            and will be cleared when you leave this form.
          </p>
        )}
        {Object.entries(
          action.endsWith("-save") || action.startsWith("config-")
            ? {}
            : response.data || {},
        ).map(([key, value]) => (
          <div key={key} className="engine-result-field">
            <h3>{fieldLabel(key)}</h3>
            {typeof value === "string" &&
            (value.includes("-----BEGIN") || key === "private_key") ? (
              <>
                <button onClick={() => downloadText(value, key + ".pem")}>
                  Download {fieldLabel(key)}
                </button>
                <pre>{value}</pre>
              </>
            ) : (
              <p>{displayValue(value)}</p>
            )}
          </div>
        ))}
        <button className="engine-primary" onClick={onSaved}>
          Done
        </button>
      </section>
    );
  const keys = Object.keys(operation.fields);
  return (
    <form className="engine-form" onSubmit={submit}>
      <h2>{operation.title}</h2>
      {error && (
        <p className="engine-error" role="alert">
          {error}
        </p>
      )}
      {operation.reference && (
        <label className="engine-field">
          <span>{action === "role-save" || action === "issue" || action === "sign" ? "Role name" : "Name or ID"}</span>
          <input
            required
            value={name}
            readOnly={!!reference}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      {operation.endpoint.includes("{mode}") && (
        <label className="engine-field">
          <span>Key storage</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="internal">
              Internal — keep private key in Vault
            </option>
            <option value="exported">Exported — return private key once</option>
            {action !== "key-generate" && (
              <option value="existing">Use an existing key</option>
            )}
          </select>
        </label>
      )}
      {groupOrder.map((group) => {
        const fields = keys.filter((key) => fieldGroup(key) === group);
        if (!fields.length) return null;
        return (
          <fieldset key={group}>
            <legend>{group}</legend>
            {fields.map((key) => {
              const field = operation.fields[key],
                value = values[key];
              const shown = Array.isArray(value)
                ? value.join("\n")
                : value === undefined
                  ? ""
                  : String(value);
              const set = (v: unknown) =>
                setValues((old) => {
                  const n = { ...old };
                  if (v === undefined) delete n[key];
                  else n[key] = v;
                  return n;
                });
              const multiline =
                field.type === "array" ||
                ["csr", "pem_bundle", "pem", "certificate", "config"].includes(
                  key,
                );
              return (
                <label className="engine-field" key={key}>
                  <span>{fieldLabel(key)}</span>
                  {field.type === "boolean" ? (
                    <select
                      value={value === undefined ? "" : String(value)}
                      onChange={(e) =>
                        set(
                          e.target.value === ""
                            ? undefined
                            : e.target.value === "true",
                        )
                      }
                    >
                      <option value="">
                        Use Vault default
                        {field.default !== undefined
                          ? " (" + displayValue(field.default) + ")"
                          : ""}
                      </option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : field.enum ? (
                    <select
                      value={shown}
                      onChange={(e) => set(e.target.value || undefined)}
                    >
                      <option value="">Use Vault default</option>
                      {field.enum.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  ) : multiline ? (
                    <textarea
                      value={shown}
                      rows={
                        ["csr", "pem_bundle", "pem", "certificate"].includes(
                          key,
                        )
                          ? 7
                          : 3
                      }
                      spellCheck={false}
                      onChange={(e) => set(e.target.value)}
                      placeholder={
                        field.type === "array"
                          ? "One value per line or separated by commas"
                          : ""
                      }
                    />
                  ) : (
                    <input
                      value={shown}
                      type={field.type === "integer" ? "number" : "text"}
                      step={field.type === "integer" ? 1 : undefined}
                      placeholder={
                        field.default !== undefined
                          ? String(field.default)
                          : field.format === "duration"
                            ? "e.g. 72h"
                            : ""
                      }
                      onChange={(e) =>
                        set(
                          e.target.value === "" && field.type === "integer"
                            ? undefined
                            : e.target.value,
                        )
                      }
                    />
                  )}
                </label>
              );
            })}
          </fieldset>
        );
      })}
      {destructive && (
        <div className="engine-notice">
          <p>
            {action === "tidy-start"
              ? "Tidy removes selected expired data from this mount. Review the safety buffers."
              : action.includes("revoke")
                ? "Revocation changes certificate validity and cannot be undone."
                : "This operation permanently removes the selected Vault objects."}
          </p>
          <label className="engine-field">
            <span>Type {mount} to confirm</span>
            <input
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        </div>
      )}
      <div className="engine-form-actions">
        <button
          className={destructive ? "engine-danger" : "engine-primary"}
          disabled={busy || (destructive && confirm !== mount)}
          type="submit"
        >
          {busy ? "Submitting…" : operation.title}
        </button>
        <Link to={cancel}>Cancel</Link>
      </div>
    </form>
  );
}
