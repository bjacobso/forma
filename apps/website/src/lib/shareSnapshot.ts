/** Publishing and opening the public, immutable snapshots the website Worker stores. */
import { MAX_SNAPSHOT_BYTES, readSnapshot, snapshotJson, type PlaygroundSnapshot } from "./playgroundSnapshot";

/** Publishes a snapshot and returns the absolute link that opens it. */
export async function publishSnapshot(snapshot: PlaygroundSnapshot): Promise<string> {
  const body = snapshotJson(snapshot);
  if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) throw new Error("Snapshots must fit within 128 KiB.");
  const response = await fetch("/playground/api/playgrounds", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Sharing requires the website Worker. The Vite server supports editing only.");
  const saved = await response.json() as { path?: string; error?: string };
  if (!response.ok || !saved.path) throw new Error(saved.error ?? "Could not publish the snapshot. Try again.");
  return new URL(saved.path, window.location.origin).href;
}

/** Loads a published snapshot of the given kind; the error explains what went wrong for the reader of the page. */
export async function fetchSnapshot<K extends PlaygroundSnapshot["kind"]>(id: string, kind: K, signal?: AbortSignal): Promise<Extract<PlaygroundSnapshot, { kind: K }>> {
  const response = await fetch(`/playground/api/playgrounds/${id}`, { signal: signal ?? null });
  if (!response.ok) throw new Error(response.status === 404 ? "This snapshot could not be found." : "This snapshot could not be loaded. Try again shortly.");
  const snapshot = readSnapshot(await response.json());
  if (snapshot?.kind !== kind) throw new Error("This link opens a different kind of snapshot, or one this page cannot read.");
  return snapshot as Extract<PlaygroundSnapshot, { kind: K }>;
}
