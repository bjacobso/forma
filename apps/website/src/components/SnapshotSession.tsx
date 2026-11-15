/**
 * Drafts and sharing for the reader and the workbench. A page opens a base (an
 * example, a link, or a published snapshot); edits are kept as a draft in this
 * browser until they are discarded or published as a public, immutable snapshot.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { readSnapshot, snapshotJson, type ReaderSnapshot, type WorkbenchSnapshot } from "../lib/playgroundSnapshot";
import { publishSnapshot } from "../lib/shareSnapshot";

type Shareable = ReaderSnapshot | WorkbenchSnapshot;

const DRAFT_PREFIX = "forma-draft:";

/** The draft key of a published snapshot. */
export const snapshotDraftKey = (kind: Shareable["kind"], id: string) => `${kind}:snapshot:${id}`;

function readDraft(key: string): { readonly savedAt: number; readonly snapshot: Shareable } | null {
  try {
    const stored = JSON.parse(localStorage.getItem(DRAFT_PREFIX + key) ?? "null") as { savedAt?: unknown; snapshot?: unknown } | null;
    const snapshot = readSnapshot(stored?.snapshot);
    return snapshot && snapshot.kind !== "custom" && typeof stored?.savedAt === "number" ? { savedAt: stored.savedAt, snapshot } : null;
  } catch { return null; }
}

/** False when the browser refuses, such as when storage is full or disabled. */
function writeDraft(key: string, snapshot: Shareable): boolean {
  try { localStorage.setItem(DRAFT_PREFIX + key, `{"savedAt":${Date.now()},"snapshot":${snapshotJson(snapshot)}}`); return true; }
  catch { return false; }
}

function clearDraft(key: string) {
  try { localStorage.removeItem(DRAFT_PREFIX + key); } catch { /* Nothing was kept. */ }
}

export interface SnapshotSession<T extends Shareable> {
  /** The state to open: a restored draft, or the base. Changes when the draft is discarded, with `revision`. */
  readonly start: T;
  readonly revision: number;
  /** When the restored draft was saved; null once discarded or when nothing was restored. */
  readonly restoredAt: number | null;
  /** The content differs from the base, so a draft is kept. */
  readonly edited: boolean;
  /** The draft could not be kept in this browser. */
  readonly storageFailed: boolean;
  /** The published snapshot the page shows, and whether the current state is still exactly it. */
  readonly shared: { readonly url: string; readonly current: boolean } | null;
  /** Report the page's current state; drafts follow a moment later. */
  readonly update: (state: T) => void;
  readonly current: () => T;
  /** The link of the published snapshot when the current state is exactly it. */
  readonly sharedLink: () => string | null;
  readonly discard: () => void;
  readonly publish: () => Promise<string>;
}

interface Base<T> { readonly key: string | null; readonly value: T; readonly shared: { readonly url: string; readonly json: string } | null }

export function useSnapshotSession<T extends Shareable>({ draftKey, base: initialBase, sharedUrl, content }: {
  /** Where the draft is kept in this browser. */
  readonly draftKey: string;
  /** What the page opened. */
  readonly base: T;
  /** The base is the published snapshot at this link. */
  readonly sharedUrl?: string | undefined;
  /** What counts as an edit, such as file contents but not which tab is shown. */
  readonly content: (state: T) => string;
}): SnapshotSession<T> {
  const [restored] = useState(() => {
    const draft = readDraft(draftKey);
    return draft && draft.snapshot.kind === initialBase.kind && content(draft.snapshot as T) !== content(initialBase) ? { savedAt: draft.savedAt, snapshot: draft.snapshot as T } : null;
  });
  const base = useRef<Base<T>>({ key: draftKey, value: initialBase, shared: sharedUrl ? { url: sharedUrl, json: snapshotJson(initialBase) } : null });
  const [start, setStart] = useState({ value: restored?.snapshot ?? initialBase, revision: 0 });
  const latest = useRef<T>(start.value);
  const [restoredAt, setRestoredAt] = useState(restored?.savedAt ?? null);
  const [edited, setEdited] = useState(Boolean(restored));
  const [storageFailed, setStorageFailed] = useState(false);
  const [shared, setShared] = useState(base.current.shared && { url: base.current.shared.url, current: !restored });
  const timer = useRef<number | undefined>(undefined);
  // The draft as last written, so its time stays the time of the last edit.
  const written = useRef<string | null>(restored ? snapshotJson(restored.snapshot) : null);

  const persist = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const { key, value, shared: published } = base.current;
    const now = latest.current;
    const changed = content(now) !== content(value);
    setEdited(changed);
    if (published) {
      const current = snapshotJson(now) === published.json;
      // The reader reports its state after every render, so an unchanged value must not render again.
      setShared(previous => (previous?.url === published.url && previous.current === current ? previous : { url: published.url, current }));
    }
    if (!key) return;
    if (!changed) { if (written.current !== null) clearDraft(key); written.current = null; setStorageFailed(false); return; }
    const json = snapshotJson(now);
    if (json === written.current) return;
    const kept = writeDraft(key, now);
    written.current = kept ? json : null;
    setStorageFailed(!kept);
  }, []);

  const update = useCallback((state: T) => {
    latest.current = state;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(persist, 300);
  }, [persist]);

  // Keep the last keystrokes when the page reloads or another example opens.
  useEffect(() => {
    const flush = () => { if (timer.current !== undefined) persist(); };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [persist]);

  const sharedLink = () => {
    const published = base.current.shared;
    return published && snapshotJson(latest.current) === published.json ? published.url : null;
  };

  const discard = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (base.current.key) clearDraft(base.current.key);
    written.current = null;
    latest.current = base.current.value;
    setStart(previous => ({ value: base.current.value, revision: previous.revision + 1 }));
    setRestoredAt(null);
    setEdited(false);
    setStorageFailed(false);
    setShared(base.current.shared && { url: base.current.shared.url, current: true });
  };

  /** Publishes the current state; the page's link becomes the snapshot's, and later edits are drafts of it. */
  const publish = async () => {
    const snapshot = latest.current;
    const url = await publishSnapshot(snapshot);
    const id = new URL(url).searchParams.get("snapshot");
    if (base.current.key) clearDraft(base.current.key);
    written.current = null;
    base.current = { key: id ? snapshotDraftKey(snapshot.kind, id) : null, value: snapshot, shared: { url, json: snapshotJson(snapshot) } };
    window.history.replaceState(window.history.state, "", url);
    setRestoredAt(null);
    setEdited(false);
    setShared({ url, current: true });
    // Edits made while publishing are a draft of the new snapshot.
    persist();
    return url;
  };

  return { start: start.value, revision: start.revision, restoredAt, edited, storageFailed, shared, update, current: () => latest.current, sharedLink, discard, publish };
}

function since(time: number): string {
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "just now";
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (minutes < 60) return format.format(-minutes, "minute");
  if (minutes < 60 * 24) return format.format(-Math.round(minutes / 60), "hour");
  return format.format(-Math.round(minutes / (60 * 24)), "day");
}

/** The draft's state with a way to discard it, and a Share button that publishes a public snapshot after confirmation. */
export function SnapshotControls<T extends Shareable>({ session, contents }: {
  readonly session: SnapshotSession<T>;
  /** What the snapshot holds, completing "Your … will be publicly readable." */
  readonly contents: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  // The link the popover shows: set when the current state is already published.
  const [link, setLink] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = () => { setOpen(false); button.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setStatus("Link copied. Anyone with it can open this snapshot."); }
    catch { setStatus("Snapshot published. Select and copy the link."); }
  };
  const toggle = () => {
    if (open) { close(); return; }
    // Publishing the same state again would make the same link.
    setLink(session.sharedLink());
    setStatus("");
    setOpen(true);
  };
  const publish = async () => {
    setSaving(true);
    setStatus("");
    try {
      const url = await session.publish();
      setLink(url);
      await copy(url);
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  const draftNote = session.storageFailed ? "This browser could not keep your draft. Share it to keep a copy."
    : session.edited ? session.restoredAt !== null ? `Restored your unshared draft from ${since(session.restoredAt)}.` : "Unshared draft, kept in this browser."
    : session.shared?.current ? "Shared snapshot" : "";

  return <div className="rd-share" ref={wrapper} onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); close(); } }}>
    {draftNote ? <span className="rd-share-note" role="status">{draftNote}</span> : null}
    {session.edited ? <button className="rd-share-discard" onClick={session.discard} type="button">Discard draft</button> : null}
    <button aria-controls={panelId} aria-expanded={open} className="rd-share-button" onClick={toggle} ref={button} type="button"><Link2 size={14} />Share</button>
    {open ? <section aria-label="Public snapshot" className="rd-share-panel" id={panelId}>
      {link ? <>
        <label>Share link<input aria-label="Share link" onFocus={event => event.target.select()} readOnly value={link} /></label>
        <div className="rd-share-actions">
          <button onClick={() => void copy(link)} type="button"><Check size={13} />Copy link</button>
          <button onClick={close} type="button">Done</button>
        </div>
      </> : <>
        <p>Your {contents} will be publicly readable by anyone with the link. Do not include secrets. Each snapshot is immutable; publishing later edits creates a new link.</p>
        <div className="rd-share-actions">
          <button autoFocus disabled={saving} onClick={() => void publish()} type="button">{saving ? "Publishing…" : "Publish snapshot"}</button>
          <button disabled={saving} onClick={close} type="button">Cancel</button>
        </div>
      </>}
      <p className="rd-share-status" role="status">{status}</p>
    </section> : null}
  </div>;
}
