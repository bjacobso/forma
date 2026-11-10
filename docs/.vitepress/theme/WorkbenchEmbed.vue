<script setup lang="ts">
import { useData } from "vitepress";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

const props = withDefaults(defineProps<{ example?: string; broken?: boolean; title?: string; file?: string; homepage?: boolean }>(), {
  example: "contracts", broken: false, title: "Live Forma compiler", file: "",
});
const { isDark } = useData();
const frame = ref<HTMLIFrameElement>();
const height = ref(720);
const selected = ref("custom");
const example = computed(() => props.homepage ? selected.value : props.example);
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
    <div v-if="props.homepage" class="fh-live-choices">
      <label>Try it live<select v-model="selected" aria-label="Live playground example"><option value="custom">Build a domain language</option><option value="contracts">Explore typed Lisp &amp; effects</option></select></label>
      <p>{{ selected === "custom" ? "A prelude defines the vocabulary. Edit the program and inspect its checked data—not an executed workflow." : "Edit an Effect contract, inspect its inferred types, and generate Effect TypeScript." }}</p>
    </div>
    <div class="fh-window">
      <iframe :key="example" ref="frame" :src="`/playground/embed/${example}${props.homepage ? '?compact=1' : props.broken ? '?broken=1' : ''}`"
        :title="props.homepage ? (selected === 'custom' ? 'Live domain language playground' : 'Live Lisp and Effect compiler') : props.file ? `${props.title} — ${props.file}` : props.title" :style="{ height: `${height}px` }" loading="lazy" @load="syncTheme" />
    </div>
    <a class="fh-live-embed__fallback" :href="example === 'custom' ? '/playground/custom' : `/playground/live/${example}`" target="_self">{{ props.homepage ? "Open full playground ↗" : "Open this example in its own page ↗" }}</a>
  </div>
</template>
