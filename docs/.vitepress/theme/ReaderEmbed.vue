<script setup lang="ts">
import { useData } from "vitepress";
import { computed, onMounted, onUnmounted, ref } from "vue";

/** A checked, hoverable Forma snippet from the playground's reader, for docs pages and blog posts. */
const props = withDefaults(defineProps<{ source?: string; example?: string; focus?: string; title?: string }>(), {
  source: "", example: "", focus: "", title: "",
});
const { isDark } = useData();
const frame = ref<HTMLIFrameElement>();
const height = ref(240);

const base64url = (text: string) => {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const src = computed(() => {
  const query = new URLSearchParams();
  if (props.source) query.set("source", base64url(props.source.trim()));
  else if (props.example) query.set("example", props.example);
  if (props.focus) query.set("focus", props.focus);
  if (props.title) query.set("title", props.title);
  return `/playground/embed/read?${query}`;
});

const syncTheme = () => frame.value?.contentWindow?.postMessage({ type: "forma-workbench-theme", theme: isDark.value ? "dark" : "light" }, window.location.origin);
const receive = (event: MessageEvent) => {
  if (event.origin !== window.location.origin || event.source !== frame.value?.contentWindow) return;
  if (event.data?.type === "forma-workbench-ready") syncTheme();
  if (event.data?.type === "forma-reader-height" && Number.isFinite(event.data.height)) height.value = Math.max(120, Math.min(2400, event.data.height));
};
onMounted(() => window.addEventListener("message", receive));
onUnmounted(() => window.removeEventListener("message", receive));
</script>

<template>
  <div class="fh-reader-embed">
    <iframe ref="frame" :src="src" :title="props.title ? `Forma snippet: ${props.title}` : 'Forma snippet'" :style="{ height: `${height}px` }" loading="lazy" @load="syncTheme" />
  </div>
</template>

<style scoped>
.fh-reader-embed { margin: 16px 0; }
.fh-reader-embed iframe { display: block; width: 100%; border: 0; background: transparent; color-scheme: normal; }
</style>
