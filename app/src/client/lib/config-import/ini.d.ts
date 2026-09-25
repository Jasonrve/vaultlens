declare module 'ini' {
  export function parse(content: string): Record<string, unknown>;
}