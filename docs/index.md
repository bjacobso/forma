---
layout: home
title: Forma
titleTemplate: false
description: A typed language for building domain-specific languages.
sidebar: false
aside: false
pageClass: forma-index
---

<div class="forma-home">
  <header class="forma-home__intro">
    <h1>Forma</h1>
    <p class="forma-home__tagline">A typed language for building domain-specific languages.</p>
    <p class="forma-home__detail">
      Write compact Lisp. Extend it with typed macros and elaborators. Compile it into portable
      artifacts—without hiding the passes in between.
    </p>
    <div class="forma-home__actions">
      <a class="forma-home__primary" href="/vision">Get started →</a>
      <a class="forma-home__secondary" href="/playground" target="_self">Playground →</a>
      <a class="forma-home__secondary" href="https://github.com/bjacobso/forma-lang">GitHub</a>
    </div>
  </header>

  <section class="forma-home__code" aria-label="Forma code examples">

  <div class="forma-home__flow" aria-label="Forma source flows through inference into portable artifacts">
    <div>
      <span>01 · Source</span>
      <strong>domain forms + typed macros</strong>
    </div>
    <div>
      <span>02 · Inference</span>
      <strong>value · failures · capabilities</strong>
    </div>
    <div>
      <span>03 · Artifact</span>
      <strong>portable, inspectable IR</strong>
    </div>
  </div>

::: code-group

<<< @/snippets/home/source.lisp{lisp}

<<< @/snippets/home/effects.lisp{lisp}

<<< @/snippets/home/artifact.json{json}

:::

  </section>

  <nav class="forma-home__guides" aria-label="Guides">
    <a href="/language">Language →</a>
    <a href="/architecture">Architecture →</a>
    <a href="/design-decisions">Design decisions →</a>
    <a href="/roadmap">Roadmap →</a>
  </nav>
</div>
