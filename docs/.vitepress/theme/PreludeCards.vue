<script setup lang="ts">
import { computed } from "vue";
import { data } from "../../preludes/preludes.data";

const props = defineProps<{ slugs?: string[]; group?: string }>();

const cards = computed(() => props.slugs
  ? props.slugs.flatMap((slug) => data.filter((card) => card.slug === slug))
  : data.filter((card) => !props.group || card.group === props.group));
</script>

<template>
  <ul class="fh-preludes">
    <li v-for="card in cards" :key="card.slug">
      <a class="fh-prelude" :href="`/preludes/${card.slug}`">
        <span class="fh-prelude__top">
          <span class="fh-prelude__file">{{ card.file }}</span>
          <span class="fh-status" :class="`is-${card.tone}`">{{ card.status }}</span>
        </span>
        <strong>{{ card.title }}</strong>
        <span class="fh-prelude__summary">{{ card.summary }}</span>
        <span v-if="card.group !== 'protocol'" class="fh-prelude__forms">{{ card.vocabulary.join(" · ") }}<template v-if="card.more"> · +{{ card.more }}</template></span>
        <span class="fh-prelude__foot"><b>Reference →</b><span>{{ card.counts }}</span></span>
      </a>
    </li>
  </ul>
</template>
