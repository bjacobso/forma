<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive } from "vue";
import stories from "../../snippets/home/hero-stories.json";

const state = reactive({
  storyIndex: 0,
  step: 1,
  elapsed: 1400,
  playing: false,
  started: false,
  reduced: false,
});
const story = computed(() => stories[state.storyIndex]!);
const steps = ["Vocabulary", "Catch", "Fix", "Outcome"];
const editing = computed(() => state.step === 2 && state.elapsed < 1400);
const repaired = computed(() =>
  Math.min(
    story.value.edit.repair.length,
    Math.floor((state.elapsed / 1400) * story.value.edit.repair.length),
  ),
);
const sourceParts = computed(() => {
  const { source, broken, diagnostic, edit } = story.value;
  if (state.step === 1) {
    const { startOffset, endOffset } = diagnostic.span;
    return [
      broken.slice(0, startOffset),
      broken.slice(startOffset, endOffset),
      broken.slice(endOffset),
    ];
  }
  if (state.step === 2)
    return [
      edit.prefix,
      editing.value ? edit.repair.slice(0, repaired.value) : edit.repair,
      edit.suffix,
    ];
  return [source, "", ""];
});
const caption = computed(
  () =>
    [
      story.value.introduction,
      "The error is attached to the source you wrote, using the language’s checked contract.",
      story.value.repairText,
      story.value.consumer,
    ][state.step],
);
const result = computed(() =>
  state.step === 0
    ? "Vocabulary defined"
    : state.step === 1
      ? "1 recorded error"
      : editing.value
        ? "Scripted edit"
        : "0 recorded errors",
);
const pause = () => {
  state.playing = false;
};
const showStep = (step: number) => {
  pause();
  state.started = true;
  state.step = Math.max(0, Math.min(3, step));
  state.elapsed = 1400;
};
const selectStory = (index: number) => {
  pause();
  state.storyIndex = index;
  state.step = 1;
  state.elapsed = 1400;
  state.started = false;
};
const replay = () => {
  state.started = true;
  state.step = 0;
  state.elapsed = 0;
  state.playing = !state.reduced;
};
const play = () => {
  if (state.reduced) {
    showStep(state.step === 3 ? 0 : state.step + 1);
    return;
  }
  if (!state.started || state.step === 3) {
    replay();
    return;
  }
  state.playing = !state.playing;
};
const keyboard = (event: KeyboardEvent) => {
  if (event.key === "ArrowRight") {
    event.preventDefault();
    showStep(state.step + 1);
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    showStep(state.step - 1);
  }
  if (event.key === "Escape") pause();
};
let timer: ReturnType<typeof setInterval>;
let media: MediaQueryList;
const syncMotion = () => {
  state.reduced = media.matches;
  pause();
  state.elapsed = 1400;
};
const visibility = () => {
  if (document.hidden) pause();
};
onMounted(() => {
  media = window.matchMedia("(prefers-reduced-motion: reduce)");
  syncMotion();
  media.addEventListener("change", syncMotion);
  document.addEventListener("visibilitychange", visibility);
  timer = setInterval(() => {
    if (!state.playing || state.reduced) return;
    state.elapsed += 100;
    if (state.elapsed >= [3000, 4500, 3600][state.step]!) {
      state.step++;
      state.elapsed = 0;
      if (state.step === 3) pause();
    }
  }, 100);
});
onUnmounted(() => {
  clearInterval(timer);
  media?.removeEventListener("change", syncMotion);
  document.removeEventListener("visibilitychange", visibility);
});
</script>

<template>
  <section
    class="hs"
    aria-label="Domain language stories"
    :data-story="story.id"
    :data-step="state.step"
    @keydown="keyboard"
  >
    <div class="hs-stories" role="group" aria-label="Choose a domain story">
      <button
        v-for="(item, index) in stories"
        :key="item.id"
        type="button"
        :aria-pressed="state.storyIndex === index"
        @click="selectStory(index)"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="hs-intro">
      <h2>{{ story.title }}</h2>
      <p>{{ story.introduction }}</p>
    </div>
    <div class="hs-steps" role="group" aria-label="Story steps">
      <button
        v-for="(label, index) in steps"
        :key="label"
        type="button"
        :aria-current="state.step === index ? 'step' : undefined"
        @click="showStep(index)"
      >
        <span>{{ index + 1 }}</span> {{ label }}
      </button>
    </div>
    <div class="hs-window">
      <div class="hs-bar">
        <span>Vocabulary → typed elaboration → checked data</span
        ><span
          :class="{
            'hs-bad': state.step === 1,
            'hs-good': state.step >= 2 && !editing,
          }"
          >{{ result }}</span
        >
      </div>
      <div class="hs-panes">
        <div class="hs-pane">
          <template v-if="state.step < 3"
            ><p class="hs-file">{{ story.preludeLabel }}</p>
            <pre>{{ story.preludeExcerpt }}</pre>
          </template>
          <div v-else class="hs-consumer">
            <p class="hs-file">The consumer boundary</p>
            <h3>{{ story.outcome }}</h3>
            <p>{{ story.consumer }}</p>
            <p v-if="story.id === 'release'" class="hs-plan">
              1. Verify · process.test<br />2. Approve · human.approve
            </p>
            <p v-if="story.id === 'query'" class="hs-plan">
              Employee → Bool predicate → qualified fields
            </p>
            <p v-if="story.id === 'effect'" class="hs-plan">
              Checked operation → Effect TypeScript → your Console service
            </p>
          </div>
        </div>
        <div class="hs-pane">
          <p class="hs-file">
            {{ state.step === 3 ? story.outputLabel : story.sourceId }}
          </p>
          <pre v-if="state.step === 3" class="hs-output">{{
            story.outputExcerpt
          }}</pre>
          <pre
            v-else
            class="hs-source"
          ><span>{{ sourceParts[0] }}</span><mark :class="{ 'hs-error-token': state.step === 1, 'hs-fixed-token': state.step === 2, 'hs-editing': editing }">{{ sourceParts[1] }}</mark><span>{{ sourceParts[2] }}</span></pre>
        </div>
      </div>
      <div class="hs-message" :class="{ 'hs-bad': state.step === 1 }">
        <template v-if="state.step === 1"
          >{{ story.diagnostic.message
          }}<span class="hs-location"
            >{{ story.sourceId }}:{{ story.diagnostic.span.startLine }}:{{
              story.diagnostic.span.startColumn
            }}
            · {{ story.diagnostic.code }}</span
          ></template
        >
        <template v-else-if="editing"
          >Scripted edit in progress. Recorded output is withheld until the
          repair is complete.</template
        >
        <template v-else-if="state.step === 0">{{
          story.id === "effect"
            ? "Supported Effect vocabulary; not a universal backend."
            : "Vocabulary and checks from a prelude, not a new parser for this example."
        }}</template>
        <template v-else
          >Recorded result: no diagnostics.
          {{
            state.step === 3
              ? "Output shown, not executed."
              : "The corrected program checks."
          }}</template
        >
      </div>
    </div>
    <p class="hs-caption" aria-live="polite" aria-atomic="true">
      {{ caption }}
    </p>
    <div class="hs-controls" role="group" aria-label="Story playback">
      <button
        type="button"
        aria-label="Previous step"
        :disabled="state.step === 0"
        @click="showStep(state.step - 1)"
      >
        ←
      </button>
      <button type="button" class="hs-play" @click="play">
        {{
          state.reduced
            ? "Step through"
            : state.playing
              ? "Pause story"
              : state.step === 3
                ? "Play again"
                : "Play story"
        }}
      </button>
      <button
        type="button"
        aria-label="Next step"
        :disabled="state.step === 3"
        @click="showStep(state.step + 1)"
      >
        →
      </button>
      <button type="button" @click="replay">Replay</button>
      <span>{{
        state.reduced
          ? "Reduced motion · manual steps"
          : "Plays once · never auto-rotates"
      }}</span>
    </div>
    <div class="hs-foot">
      <p>
        Scripted stories, real recorded compiler results. Not live evaluation.
      </p>
      <a :href="story.href">{{ story.linkLabel }} ↗</a>
    </div>
    <details :key="story.id" class="hs-evidence">
      <summary>Inspect this story’s sources and compiler result</summary>
      <p v-if="story.id === 'query'">
        The full <a href="/preludes/ontology">ontology prelude</a> supplies the
        types and helpers used by this query form. The linked entity playground
        shows stored output, not live ontology elaboration.
      </p>
      <template v-if="story.prelude"
        ><h3>
          {{
            story.id === "query"
              ? "Query form definition"
              : "Complete example prelude"
          }}
        </h3>
        <pre>{{ story.prelude }}</pre>
      </template>
      <h3>Corrected source</h3>
      <pre>{{ story.source }}</pre>
      <h3>Recorded diagnostic</h3>
      <pre>{{ JSON.stringify(story.diagnostic, null, 2) }}</pre>
      <h3>Complete recorded output</h3>
      <pre>{{ story.output }}</pre>
      <p>
        Forma checks language/type/effect contracts. Consumers own business
        meaning. Checked data does not prove interpreter agreement, legal
        correctness, authorization or agent safety.
      </p>
    </details>
  </section>
</template>

<style scoped>
.hs {
  min-width: 0;
  --hs-error: #ffb0aa;
  --hs-ok: #aed7af;
}
.hs-stories {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
.hs button {
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid var(--vp-c-border);
  border-radius: 5px;
  font: 500 13px/1.4 var(--vp-font-family-base);
  color: var(--fh-ink);
  background: transparent;
  cursor: pointer;
}
.hs-stories button[aria-pressed="true"] {
  background: var(--fh-ink);
  border-color: var(--fh-ink);
  color: var(--vp-c-bg);
}
.hs-intro h2 {
  font-size: 24px;
  line-height: 1.2;
  letter-spacing: -0.03em;
}
.hs-intro p {
  font-size: 14px;
  line-height: 1.6;
  color: var(--fh-body);
  margin-top: 6px;
}
.hs-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 16px 0 12px;
}
.hs-steps button {
  border: 0;
  border-radius: 0;
  border-bottom: 2px solid var(--vp-c-border);
  text-align: left;
  padding: 8px 0;
  font-size: 12px;
}
.hs-steps button[aria-current="step"] {
  border-color: var(--vp-c-brand-1);
}
.hs-steps span {
  color: var(--fh-body);
  margin-right: 6px;
  font-variant-numeric: tabular-nums;
}
.hs-window {
  border-radius: 7px;
  overflow: hidden;
  background: var(--fh-win-bg);
  color: var(--fh-win-ink);
}
.hs-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 16px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--fh-win-line);
  font-size: 12px;
  color: #b8c1b8;
}
.hs-bar .hs-bad,
.hs-message.hs-bad {
  color: var(--hs-error);
}
.hs-bar .hs-good {
  color: var(--hs-ok);
}
.hs-panes {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.hs-pane {
  min-width: 0;
  padding: 16px 18px;
}
.hs-pane + .hs-pane {
  border-left: 1px solid var(--fh-win-line);
}
.hs .hs-file {
  font-size: 11px;
  line-height: 1.5;
  color: #b8c1b8;
  margin-bottom: 12px;
}
.hs pre {
  margin: 0;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 12px/1.8 var(--vp-font-family-mono);
  tab-size: 2;
}
.hs mark {
  color: inherit;
  background: transparent;
}
.hs .hs-error-token {
  color: var(--hs-error);
  background: #422d29;
  text-decoration: underline wavy var(--hs-error);
  text-underline-offset: 4px;
}
.hs .hs-fixed-token {
  color: var(--hs-ok);
  background: #2c402e;
}
.hs-editing {
  border-right: 1px solid var(--fh-win-ink);
}
.hs-message {
  padding: 12px 18px;
  border-top: 1px solid var(--fh-win-line);
  font-size: 13px;
  line-height: 1.6;
  min-height: 66px;
}
.hs-location {
  display: block;
  font: 11px/1.8 var(--vp-font-family-mono);
  color: #b8c1b8;
}
.hs .hs-consumer h3 {
  color: var(--fh-win-ink);
  font-size: 21px;
  line-height: 1.3;
  letter-spacing: -0.02em;
  max-width: 24ch;
}
.hs .hs-consumer p:not(.hs-file) {
  font-size: 14px;
  line-height: 1.7;
  color: var(--fh-win-ink);
  margin-top: 16px;
  max-width: 42ch;
}
.hs .hs-consumer .hs-plan {
  font: 12px/1.8 var(--vp-font-family-mono);
  color: var(--hs-ok);
}
.hs .hs-caption {
  min-height: 48px;
  margin-top: 14px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--fh-body);
}
.hs-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
  align-items: center;
}
.hs-controls button:first-child,
.hs-controls button:nth-child(3) {
  min-width: 44px;
}
.hs-controls .hs-play {
  min-width: 104px;
  background: var(--fh-ink);
  color: var(--vp-c-bg);
  border-color: var(--fh-ink);
}
.hs button:disabled {
  opacity: 0.45;
  cursor: default;
}
.hs-controls > span {
  margin-left: auto;
  font-size: 11px;
  color: var(--fh-body);
}
.hs-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px 24px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--vp-c-divider);
}
.hs-foot p,
.hs-foot a {
  font-size: 12px;
  line-height: 1.6;
}
.hs-foot p {
  color: var(--fh-body);
}
.hs-foot a {
  color: var(--vp-c-brand-1);
  text-underline-offset: 3px;
}
.hs-evidence {
  margin-top: 12px;
  font-size: 12px;
  color: var(--fh-body);
}
.hs-evidence summary {
  min-height: 44px;
  padding: 12px 4px;
  cursor: pointer;
  list-style-position: inside;
}
.hs-evidence h3 {
  font-size: 14px;
  margin: 16px 0 8px;
}
.hs-evidence pre {
  font-size: 11px;
  margin-bottom: 16px;
}
.hs-evidence p {
  font-size: 13px;
  line-height: 1.7;
  margin: 12px 0;
}
.hs button:focus-visible,
.hs a:focus-visible,
.hs summary:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}
@media (hover: hover) {
  .hs button:not(:disabled):hover {
    outline: 1px solid var(--vp-c-text-2);
    outline-offset: 2px;
  }
}
@keyframes hs-arrive {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: no-preference) {
  .hs-output,
  .hs-consumer {
    animation: hs-arrive 200ms ease-out;
  }
}
@media (max-width: 760px) {
  .hs-stories {
    gap: 6px;
  }
  .hs-stories button {
    padding: 8px 10px;
    font-size: 12px;
  }
  .hs-intro h2 {
    font-size: 22px;
  }
  .hs-panes {
    grid-template-columns: minmax(0, 1fr);
  }
  .hs-pane {
    padding: 14px;
  }
  .hs-pane + .hs-pane {
    border-left: 0;
    border-top: 1px solid var(--fh-win-line);
  }
  .hs pre {
    font-size: 11px;
    line-height: 1.7;
  }
  .hs-stories {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }
  .hs-stories button {
    padding: 8px 6px;
    font-size: 12px;
  }
  .hs-bar,
  .hs-message {
    padding: 12px 14px;
  }
  .hs-controls > span {
    flex-basis: 100%;
    margin: 4px 0 0;
  }
  .hs-steps button {
    font-size: 11px;
  }
  .hs-steps span {
    display: block;
  }
  .hs .hs-caption {
    min-height: 72px;
  }
  .hs .hs-consumer h3 {
    max-width: none;
  }
  .hs .hs-consumer p:not(.hs-file) {
    max-width: none;
  }
  .hs-window {
    border-radius: 6px;
  }
}
</style>
