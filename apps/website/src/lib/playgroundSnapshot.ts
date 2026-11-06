export interface PreludeDemo {
  readonly title: string;
  readonly prelude: string;
  readonly source: string;
}

export const MAX_SNAPSHOT_BYTES = 128 * 1024;
export const snapshotIdPattern = /^[a-f0-9]{32}$/;

export function readSnapshot(value: unknown): PreludeDemo | null {
  if (!value || typeof value !== "object") return null;
  const demo = value as Record<string, unknown>;
  if (demo.version !== 1 || typeof demo.title !== "string" || !demo.title.trim() || demo.title.length > 160 || typeof demo.prelude !== "string" || typeof demo.source !== "string") return null;
  return { title: demo.title, prelude: demo.prelude, source: demo.source };
}
