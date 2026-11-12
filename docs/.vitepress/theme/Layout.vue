<script setup lang="ts">
import DefaultTheme from "vitepress/theme-without-fonts";
import family from "../family.json";
import navigation from "../navigation.json";
</script>

<template>
  <DefaultTheme.Layout>
    <template #layout-bottom>
      <aside class="family-strip" aria-label="WorldVM family">
        <a v-for="project in family" :key="project.name" :href="project.site" :data-tier="project.tier">
          <strong>{{ project.name }}</strong><span>{{ project.pitch }}</span>
        </a>
      </aside>
      <footer class="shared-footer">
        <nav aria-label="Footer navigation">
          <a v-for="item in navigation" :key="item.text" :href="item.link">{{ item.text }}</a>
          <a href="/feed.xml">Atom feed</a>
        </nav>
        <p><a href="https://worldvm.com">Part of the WorldVM family</a></p>
        <p>Released under the MIT License. © 2026 Ben Jacobson</p>
      </footer>
    </template>
  </DefaultTheme.Layout>
</template>
