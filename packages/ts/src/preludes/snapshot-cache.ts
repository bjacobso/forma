/** Opt-in storage boundary. Browser consumers never import filesystem code. */
export interface PreludeSnapshotCache {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

export let preludeSnapshotCache: PreludeSnapshotCache | undefined;

export function setPreludeSnapshotCache(cache: PreludeSnapshotCache | undefined): void {
  preludeSnapshotCache = cache;
}
