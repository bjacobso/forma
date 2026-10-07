<script setup lang="ts">
import { useData } from "vitepress";
import { onMounted, onUnmounted, ref, watch } from "vue";

const props = withDefaults(defineProps<{ example?: string; broken?: boolean; title?: string; file?: string }>(), {
  example: "contracts", broken: false, title: "Live Forma workbench", file: "",
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
  <div class="fh-live-embed" :class="{ 'fh-live-embed--broken': props.broken }">
    <div class="fh-window">
      <div class="fh-window__bar" aria-hidden="true">
        <span class="fh-window__dots"><i /><i /><i /></span>
        <span>{{ props.file || `${props.example}.forma` }} — live compiler</span>
        <span class="fh-window__meta">{{ props.broken ? "starts broken" : "runs in your browser" }}</span>
      </div>
      <iframe ref="frame" :src="`/playground/embed/${props.example}${props.broken ? '?broken=1' : ''}`"
        :title="props.title" :style="{ height: `${height}px` }" loading="lazy" @load="syncTheme" />
    </div>
    <a class="fh-live-embed__fallback" :href="`/playground/live/${props.example}`" target="_self">Open this workbench in its own page ↗</a>
  </div>
</template>
