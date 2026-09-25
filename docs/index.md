---
layout: home
title: Forma
titleTemplate: false
description: Forma is a typed Lisp for inventing domain languages and elaborating them into reviewable, portable systems.
sidebar: false
aside: false
pageClass: forma-index
---

<div class="forma-home">
  <div class="forma-home__signal" aria-hidden="true"><span>FORMA / FIELD NOTES 001</span><span>AN EXPERIMENT IN UNIVERSAL AUTHORING</span><span>PRE-ALPHA · OPEN RESEARCH</span></div>

  <header class="forma-home__hero">
    <div class="forma-home__hero-copy">
      <p class="forma-home__kicker"><span class="forma-home__pulse"></span> A language laboratory</p>
      <h1>What if one language could <em>author every system?</em></h1>
      <p class="forma-home__lead">Forma is a typed Lisp for making domain languages. Write the idea once, then elaborate it into checked, inspectable artifacts for the systems that will run it.</p>
      <div class="forma-home__actions"><a class="forma-home__primary" href="/playground" target="_self">Enter the playground <span aria-hidden="true">↗</span></a><a class="forma-home__secondary" href="/vision">Read the thesis <span aria-hidden="true">→</span></a></div>
      <p class="forma-home__hero-footnote">A working compiler. An unfinished hypothesis. Every pass is open to inspection.</p>
    </div>
    <div class="forma-home__specimen" aria-label="Forma source elaborating into typed artifacts">
      <div class="forma-home__specimen-top"><span>EXPERIMENT 01 / ELABORATION</span><span class="forma-home__specimen-live">LIVE LANGUAGE CORE</span></div>
      <div class="forma-home__specimen-source">
        <div class="forma-home__specimen-label"><span>INPUT / FORMA</span><span>01:07</span></div>
        <pre><code><span class="syn-comment">; the author's vocabulary</span>
<span class="syn-keyword">(define-entity</span> Employee
  (:field [employee/name <span class="syn-type">String</span> {:required true}])
  (:field [employee/active <span class="syn-type">Bool</span>]))
<span class="syn-keyword">(define-query</span> directory
  (:from Employee)
  (:where employee/active)
  (:select [employee/name]))</code></pre>
      </div>
      <div class="forma-home__specimen-mid"><span>READ</span><i></i><span>EXPAND</span><i></i><span>INFER</span><i></i><span>ELABORATE</span><b>↓</b></div>
      <div class="forma-home__specimen-output"><span>OUTPUT / TYPED ARTIFACT</span><strong>Query · directory</strong><small>source-linked · reviewable · portable</small></div>
      <div class="forma-home__specimen-bottom"><span>THE COMPILER SHOWS ITS WORK</span><span>⌁</span></div>
    </div>
  </header>

  <section class="forma-home__thesis" aria-labelledby="thesis-heading">
    <div class="forma-home__section-index">01 / THE THESIS</div>
    <div><h2 id="thesis-heading">The DSL to make <em>the next DSL.</em></h2><p>Most domain languages stop at a bespoke syntax and a black-box generator. Forma treats the language itself as a programmable material: Lisp forms become typed domain concepts, and elaborators turn those concepts into artifacts a human can trace back to source.</p></div>
    <div class="forma-home__thesis-aside">ONE SMALL CORE<br />MANY DOMAIN VOCABULARIES<br />VISIBLE TRANSFORMATIONS</div>
  </section>

  <section class="forma-home__machine" aria-labelledby="machine-heading">
    <div class="forma-home__section-heading"><div><span class="forma-home__section-index">02 / THE MACHINE</span><h2 id="machine-heading">Author once. Inspect every transformation.</h2></div><p>Elaboration is the experiment: preserve meaning as a compact source program becomes a typed contract, then a target projection.</p></div>
    <div class="forma-home__stages">
      <article><span class="forma-home__stage-number">01</span><div class="forma-home__stage-icon">( )</div><h3>Author</h3><p>Write a human-sized domain language with forms and macros.</p></article>
      <article><span class="forma-home__stage-number">02</span><div class="forma-home__stage-icon">∴</div><h3>Prove</h3><p>Infer values, typed failures, and required capabilities.</p></article>
      <article><span class="forma-home__stage-number">03</span><div class="forma-home__stage-icon">↗</div><h3>Elaborate</h3><p>Produce a portable artifact with a path back to its source.</p></article>
      <article><span class="forma-home__stage-number">04</span><div class="forma-home__stage-icon">{ }</div><h3>Project</h3><p>Let target adapters give the same idea a concrete home.</p></article>
    </div>
  </section>

  <section class="forma-home__targets" aria-labelledby="targets-heading">
    <div class="forma-home__targets-copy"><span class="forma-home__section-index">03 / THE HORIZON</span><h2 id="targets-heading">One idea.<br /><em>Many runtimes.</em></h2><p>The authoring layer should outlive any one framework. Today, Forma has two language engines, portable effect artifacts, and an Effect TypeScript projection. Rust and OCaml output are directions for future target experiments.</p><a href="/roadmap">See what exists and what comes next <span aria-hidden="true">→</span></a></div>
    <div class="forma-home__target-board" aria-label="Current and proposed target projections">
      <div class="forma-home__target-board-head"><span>PROJECTION BOARD</span><span>STATUS / 2026</span></div>
      <div class="forma-home__target-row"><span class="forma-home__target-glyph">E<span>.</span></span><div><strong>Effect / TypeScript</strong><small>Types, services, schemas</small></div><span class="forma-home__target-status is-active">WORKING PROJECTION</span></div>
      <div class="forma-home__target-row"><span class="forma-home__target-glyph">R<span>.</span></span><div><strong>Rust</strong><small>Contracts, services, native systems</small></div><span class="forma-home__target-status">RESEARCH DIRECTION</span></div>
      <div class="forma-home__target-row"><span class="forma-home__target-glyph">O<span>.</span></span><div><strong>OCaml</strong><small>Typed modules and native tooling</small></div><span class="forma-home__target-status">RESEARCH DIRECTION</span></div>
      <div class="forma-home__target-board-foot">THE ARTIFACT IS THE HANDOFF. THE SOURCE IS THE CONTRACT.</div>
    </div>
  </section>

  <section class="forma-home__review" aria-labelledby="review-heading">
    <div class="forma-home__review-copy"><span class="forma-home__section-index">04 / THE HUMAN LOOP</span><h2 id="review-heading">A review surface for humans, not just compilers.</h2><p>Generated code is useful. It is a poor place to decide whether a system means the right thing. Forma keeps the authored form, inferred contract, expansion, and emitted artifact in view so reviewers can follow the decision from intention to implementation.</p><a href="/playground" target="_self">Watch the compiler passes <span aria-hidden="true">↗</span></a></div>
    <div class="forma-home__review-panel" aria-label="Example of source-linked review">
      <div class="forma-home__review-panel-head"><span>REVIEW / OPERATION CONTRACT</span><span>● SOURCE-LINKED</span></div>
      <div class="forma-home__review-line"><span>01</span><code>(define-operation log [message]</code></div>
      <div class="forma-home__review-line"><span>02</span><code>  (do! [_ (Console.print message)]</code></div>
      <div class="forma-home__review-line"><span>03</span><code>    (succeed nil)))</code></div>
      <div class="forma-home__review-reading"><span>THE CONTRACT, IN PLAIN SIGHT</span><p>Returns <strong>Unit</strong>. May fail with <strong>ConsoleUnavailable</strong>. Requires <strong>Console.print</strong>.</p></div>
    </div>
  </section>

  <section class="forma-home__closing"><span class="forma-home__section-index">THE EXPERIMENT IS OPEN</span><h2>Build a language.<br /><em>See what it becomes.</em></h2><div class="forma-home__actions"><a class="forma-home__primary" href="/playground" target="_self">Explore the live compiler <span aria-hidden="true">↗</span></a><a class="forma-home__secondary" href="https://github.com/bjacobso/forma-lang">Explore the source <span aria-hidden="true">→</span></a></div></section>
  <nav class="forma-home__guides" aria-label="Guides"><a href="/language">Language</a><a href="/architecture">Architecture</a><a href="/design-decisions">Design decisions</a><a href="/roadmap">Roadmap</a></nav>
</div>
