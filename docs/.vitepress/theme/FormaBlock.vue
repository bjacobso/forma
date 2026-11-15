<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

/**
 * A live Forma code block (see ../formaFences.ts). The build renders it as the
 * highlighted code in the slot. Near the viewport it loads the playground's
 * reader and swaps it in at the same size: types on hover, structural selection,
 * and live checking. Every block on a page shares one analysis worker.
 */
const props = withDefaults(defineProps<{ code: string; file?: string; preludes?: string; continued?: boolean }>(), {
  file: "", preludes: "", continued: false,
});

/** Built by apps/website (src/reading/embed.ts) and served beside the docs. */
const READER = "/playground/reader-embed.js";

const root = ref<HTMLElement>();
const host = ref<HTMLElement>();
const loading = ref(false);
const live = ref(false);
let observer: IntersectionObserver | undefined;
let unmount: (() => void) | undefined;
let gone = false;

const decode = (code: string) => {
  const binary = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
};
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

async function upgrade() {
  observer?.disconnect();
  loading.value = true;
  // The page's other blocks: what came before, for a continued page, and the files a named block can import.
  const blocks = [...document.querySelectorAll<HTMLElement>(".forma-block")];
  const earlier = blocks.slice(0, blocks.indexOf(root.value!));
  const before = props.continued
    ? earlier.filter(block => block.dataset.continued !== undefined && !block.dataset.file).map(block => decode(block.dataset.code!)).join("\n\n")
    : "";
  const files = props.file
    ? blocks.filter(block => block.dataset.file && block !== root.value).map(block => ({ id: block.dataset.file!, source: decode(block.dataset.code!) }))
    : [];
  try {
    const { mountSnippet } = await import(/* @vite-ignore */ READER);
    if (gone) return;
    unmount = await mountSnippet(host.value!, {
      // A fence's content ends with a newline; the static block shows no empty last line either.
      source: decode(props.code).replace(/\n+$/, ""),
      ...(props.file ? { file: props.file } : {}),
      ...(props.preludes ? { preludes: props.preludes } : {}),
      ...(before ? { before } : {}),
      files,
      chrome: "bare",
      // Docs code blocks are dark in both page themes.
      theme: "dark",
    });
    // Show the reader once it has laid out, so the swap does not move the page.
    await frame();
    await frame();
    live.value = true;
  } catch {
    // The playground is not served here, such as under `vitepress dev`: keep the static block.
    loading.value = false;
  }
}

onMounted(() => {
  observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void upgrade(); }, { rootMargin: "600px 0px" });
  observer.observe(root.value!);
});
onBeforeUnmount(() => {
  gone = true;
  observer?.disconnect();
  unmount?.();
});
</script>

<template>
  <div ref="root" class="forma-block" :class="{ live }" :data-code="props.code" :data-file="props.file || undefined" :data-continued="props.continued ? '' : undefined">
    <div v-show="!live" class="forma-block__static">
      <slot />
      <div v-if="loading" class="forma-block__typeline">Loading the checker…</div>
    </div>
    <div ref="host" class="forma-block__live" />
  </div>
</template>

<style>
.forma-block { position: relative; }
/* The reader lays out out of sight until it replaces the static code. */
.forma-block:not(.live) .forma-block__live { position: absolute; inset: 0 0 auto; visibility: hidden; pointer-events: none; }
/* Matches the reader's type line (.rd-typeline), which takes its place. */
.forma-block__typeline {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 24px;
  border-top: 1px solid rgba(233, 236, 229, 0.1);
  color: #a3aba2;
  font-family: var(--vp-font-family-base);
  font-size: 12px;
}
</style>
