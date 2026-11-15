/**
 * Reader snippets for other sites on this origin, such as the docs' Forma code
 * blocks. Built to the stable path /playground/reader-embed.js; the reader,
 * its styles, and its shared analysis worker load on the first mount.
 */
import type { MountOptions } from "./mount";

export type { MountOptions };

export async function mountSnippet(element: HTMLElement, options: MountOptions): Promise<() => void> {
  const { mountSnippet: mount } = await import("./mount");
  return mount(element, options);
}
