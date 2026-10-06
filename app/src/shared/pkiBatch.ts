export type PkiBatchAction = "export" | "revoke" | "remove";
export interface PkiBatchRef {
  id: number;
  sourceId: string;
  fingerprint: string;
  serial: string;
  cn: string;
  sourcePath?: string;
}
export interface PkiBatchPreview {
  certificate: PkiBatchRef;
  eligible: boolean;
  reason?: string;
}
export const pkiBatchLimit = 10000;
