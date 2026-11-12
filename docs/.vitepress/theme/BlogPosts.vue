<script setup lang="ts">
import { data as posts } from "../../blog.data";
</script>

<template>
  <ul class="blog-posts">
    <li v-for="post in posts" :key="post.path">
      <a :href="post.path">{{ post.title }}</a>
      <p>{{ post.description }}</p>
      <time :datetime="post.date">{{ post.date }}</time>
    </li>
  </ul>
</template>
