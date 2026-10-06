<script setup lang="ts">
import { useData } from "vitepress";
import DefaultTheme from "vitepress/theme-without-fonts";
import { ref, watchEffect } from "vue";

const { frontmatter } = useData();
const banner = ref<HTMLElement>();
const bannerHeight = ref(0);

// The mobile menu must leave room for the banner, including wrapped text.
watchEffect((onCleanup) => {
  if (!banner.value) return;
  const element = banner.value;
  const updateHeight = () => {
    bannerHeight.value = element.getBoundingClientRect().height;
  };
  updateHeight();
  const observer = new ResizeObserver(updateHeight);
  observer.observe(element);
  onCleanup(() => observer.disconnect());
}, { flush: "post" });
</script>

<template>
  <DefaultTheme.Layout :style="{ '--worldvm-banner-height': `${bannerHeight}px` }">
    <template #layout-top>
      <p v-if="frontmatter.pageClass === 'forma-index'" ref="banner" class="worldvm-banner">
        Forma is an incubation project within <a href="https://worldvm.com/">WorldVM</a>.
      </p>
    </template>
  </DefaultTheme.Layout>
</template>
