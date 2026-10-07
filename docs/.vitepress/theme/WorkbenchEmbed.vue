<script setup lang="ts">
import { useData } from "vitepress";
import { onMounted, onUnmounted, ref, watch } from "vue";

const props = withDefaults(defineProps<{ example?: string; broken?: boolean; title?: string }>(), {
  example: "contracts", broken: false, title: "Live Forma workbench",
});
const { isDark } = useData();
const frame = ref<HTMLIFrameElement>();
const height = ref(720);
const syncTheme = () => frame.value?.contentWindow?.postMessage({
  type: "forma-workbench-theme", theme: isDark.value ? "dark" : "light",
}, window.location.origin);
const receive = (event: MessageEvent) => {
  if (event.origin !== window.location.origin || event.source !== frame.value?.contentWindow) return;
  if (event.data?.type === "forma-workbench-ready") syncTheme();
  if (event.data?.type === "forma-workbench-height" && Number.isFinite(event.data.height)) {
    height.value = Math.max(400, Math.min(2000, event.data.height));
  }
};
watch(isDark, syncTheme);
onMounted(() => window.addEventListener("message", receive));
onUnmounted(() => window.removeEventListener("message", receive));
</script>

<template>
  <div class="fh-live-embed">
    <iframe ref="frame" :src="`/playground/embed/${props.example}${props.broken ? '?broken=1' : ''}`"
      :title="props.title" :style="{ height: `${height}px` }" loading="lazy" @load="syncTheme" />
    <a class="fh-live-embed__fallback" :href="`/playground/live/${props.example}`" target="_self">Open this workbench in its own page ↗</a>
  </div>
</template>
