---
layout: home
title: Forma
titleTemplate: false
description: Forma is a typed Lisp for domain languages. Preludes define the keywords as library code; the compiler checks programs that use them and emits typed artifacts.
sidebar: false
aside: false
pageClass: forma-index
---

<div class="forma-home">

<header class="fh-hero" aria-labelledby="hero-title">
<div class="fh-hero__copy">
<p class="fh-eyebrow">Forma <span>· typed Lisp · pre-alpha</span></p>
<h1 id="hero-title">A typed Lisp for domain languages.</h1>
<p class="fh-sub">Define the keywords. Check the programs. Emit the contracts.</p>
<p class="fh-lead">Forma is a small language with a checked core. A <strong>prelude</strong> teaches it new keywords like <code>entity</code>, <code>endpoint</code>, or <code>rule</code>. Programs written in them get Hindley–Milner types, effect sets, errors at the line you wrote, and plain Effect TypeScript.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="/language">Read the guide</a>
<a class="fh-button" href="#live">Try it in your browser ↓</a>
</div>
</div>
<div class="fh-hero__side">
<div class="fh-window">
<div class="fh-window__bar"><span class="fh-window__dots" aria-hidden="true"><i></i><i></i><i></i></span><span>warmup.lisp</span><span>vocabulary from preludes/email.lisp</span></div>

<<< @/snippets/email/rule.lisp

<div class="fh-window__foot">read → expand → <b>infer</b> → elaborate → emit</div>
</div>
</div>
</header>

<section class="fh-statement" aria-labelledby="problem-heading">
<p class="fh-statement__big">An entity is a JSON Schema, an OpenAPI path, a TypeScript interface, and a template nobody owns.</p>
<p>Every copy drifts, and when something breaks, the error points at generated code instead of the decision someone made. A builder DSL in TypeScript stops the drift, but the model becomes a program you can't review, sandbox, or port. An external DSL needs its own parser, checker, and tooling.</p>
<h2 id="problem-heading" class="fh-statement__question">What if the domain language were just a library?</h2>
</section>

<section id="live" class="fh-row" aria-labelledby="live-heading">
<div class="fh-row__head">
<p class="fh-row__num">Live</p>
<h2 id="live-heading">The real compiler, running in this page.</h2>
</div>
<div class="fh-row__body">
<p>Edit real source. <strong>Watch typing</strong> removes a requirement, pauses on the compiler's red underline, and types the repair. Inferred contracts, diagnostics, typed IR, and Effect TypeScript all come from the source in this editor.</p>
<p>Switch examples to explore inference and macro expansion, or open the <a href="/playground" target="_self">full playground</a>.</p>
</div>
<div class="fh-row__wide fh-hero__demo">

<WorkbenchEmbed example="contracts" file="log.forma" title="Live contract workbench: edit, infer, and generate Effect TypeScript" />

</div>
</section>

<section id="how-it-works" class="fh-row" aria-labelledby="library-heading">
<div class="fh-row__head">
<p class="fh-row__num">01</p>
<h2 id="library-heading">Keywords are library code.</h2>
<span class="fh-status is-stored">Stored output in the browser</span>
</div>
<div class="fh-row__body">
<p><code>entity</code> is not built into the compiler. A prelude describes it with <code>form</code>: its slots, the name it binds, its result type, and the hook that constructs its output.</p>
<div class="fh-window">
<div class="fh-window__bar"><span>preludes/ontology.lisp</span><span>the definition</span></div>

<<< @/snippets/home/define-entity.lisp{6,18,24,31}

<div class="fh-window__bar fh-window__bar--run"><span>schema.lisp</span><span>the use</span></div>

<<< @/snippets/home/entities.lisp

</div>
<p>The elaboration hooks resolve <code>Employee</code>, check that <code>:where</code> is boolean, and project the selected fields into typed IR. <a href="/playground/demo/entities" target="_self">Open this example →</a></p>
<p class="fh-row__after">Swap the prelude and you have a different language on the same checked core.</p>
</div>
</section>

<section id="contracts" class="fh-row" aria-labelledby="contract-heading">
<div class="fh-row__head">
<p class="fh-row__num">02</p>
<h2 id="contract-heading">The type says what code can do.</h2>
<span class="fh-status is-live">Live · TypeScript engine</span>
</div>
<div class="fh-row__body">
<p>Operations check <code>Effect&lt;A, E, R&gt;</code> contracts. A reviewer reads one line instead of a call graph.</p>
<dl class="fh-effect">
<div><dt>A</dt><dd>the value it returns</dd></div>
<div><dt>E</dt><dd>every failure it can raise, as a closed set</dd></div>
<div><dt>R</dt><dd>every capability it touches, as a closed set</dd></div>
</dl>
<div class="fh-window fh-window--tabs">

::: code-group

<<< @/snippets/home/log.lisp [log.lisp]

<<< @/snippets/home/log.type.txt [checked type]

<<< @/snippets/home/log.ts [generated.ts]

:::

</div>
<p class="fh-row__after">The contract survives code generation.</p>
<p>Requirements are lowered to <code>Context</code> services in the generated Effect TypeScript. <a href="/effect">Building with Effect? Read what Forma adds, and what it costs →</a></p>
</div>
</section>

<section id="diagnostics" class="fh-row fh-tone-red" aria-labelledby="errors-heading">
<div class="fh-row__head">
<p class="fh-row__num">03</p>
<h2 id="errors-heading">Errors point at what you wrote.</h2>
<span class="fh-status is-live">Live · Effect checker</span>
</div>
<div class="fh-row__body">
<p>When a generated file fails to compile, the mistake is usually somewhere else: a missing entry in a YAML file three directories away, and the error never mentions it.</p>
<p>Here the body calls <code>Console.print</code>, but the signature declares no requirements. The Effect checker rejects the operation and points at the call you wrote. Click the problem to jump to its source, then add <code>Console.print</code> to the signature, or press Reset, and generation resumes.</p>
</div>
<div class="fh-row__wide">

<WorkbenchEmbed example="contracts" file="log.forma" broken title="A live missing-capability error" />

</div>
</section>

<section id="tools" class="fh-row" aria-labelledby="ambition-heading">
<div class="fh-row__head">
<p class="fh-row__num">04</p>
<h2 id="ambition-heading">One descriptor. Every tool.</h2>
</div>
<div class="fh-row__body">
<p>A form's descriptor already teaches the compiler its checks, the structural workbench its slots, and this site its <a href="/preludes/">reference pages</a>. The same program can be source, an outline, or a domain view.</p>
<div class="fh-window">
<div class="fh-window__bar"><span>one descriptor, many readers</span></div>
<pre class="fh-ascii" v-pre aria-label="A prelude form descriptor is read by the compiler for slot checks, types, and effect sets; by editor tooling for diagnostics, hover, and slot placeholders; by this site for generated reference pages; and by code generation for typed IR and Effect TypeScript."><span class="fh-ascii__code">(form (rule name lanes clause ...) …)</span>
   │
   ├─ <b>compiler</b>    slot checks · HM types · effect sets
   ├─ <b>editor</b>      diagnostics · hover · slot placeholders
   ├─ <b>reference</b>   generated prelude pages
   └─ <b>artifacts</b>   typed IR · Effect TypeScript</pre>
</div>
<p class="fh-row__after">A new language should feel as supported as a built-in one.</p>
<p>The structural workbench edits an onboarding workflow as rows and as source at the same time, with live values and types, descriptor placeholders, and assistant proposals you review as tree diffs. <a href="/workbench-vision">Read the workbench vision →</a></p>
</div>
</section>

<section id="preludes" class="fh-section" aria-labelledby="preludes-heading">
<div class="fh-section__split">
<div>
<p class="fh-label">Preludes</p>
<h2 id="preludes-heading">Languages built on Forma.</h2>
</div>
<p>Each prelude is one source file. Its reference page is generated from that file: forms, slot types, signatures, and the comments its author wrote.</p>
</div>

<PreludeCards :slugs="['email', 'http-api', 'elm', 'ontology', 'ui', 'kernel']" />

<p class="fh-more">Plus <code>viewspec</code>, <code>system</code>, <code>compiler</code>, and six host protocol preludes. <a href="/preludes/">All preludes →</a></p>

<div class="fh-kit">
<div>
<p class="fh-label">For prelude authors</p>
<h2>Write a prelude. Get a language.</h2>
<p class="fh-lead">Descriptors are the single source for a keyword. The checker, the editor, and the reference read the same form, so a domain language gets its tooling from the prelude you already wrote.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="/writing-a-form">Write your first form</a>
<a class="fh-button" href="/preludes/email">Read a generated reference</a>
</div>
</div>
<ul class="fh-checklist" aria-label="What a prelude author gets today, and what is planned">
<li><span><strong>Checked programs</strong>Slot types, Hindley–Milner inference, and effect sets for every use of a form.</span><em>engine</em></li>
<li><span><strong>Generated reference</strong>Forms, slots, types, and signatures with their doc comments, built from the source.</span><em>this site</em></li>
<li><span><strong>Live playground</strong>The browser compiler runs prelude vocabularies such as email rules and Elm commands.</span><em>@formalang/ts</em></li>
<li><span><strong>Editor support</strong>Diagnostics and hover in the language server; slot placeholders in the workbench.</span><em>LSP · workbench</em></li>
<li class="is-planned"><span><strong>Diagnostic catalog</strong>Stable codes with an explanation page for each.</span><em>RFC 0017</em></li>
<li class="is-planned"><span><strong>Tests in Forma</strong>Example programs that assert their own results.</span><em>RFC 0015</em></li>
<li class="is-planned"><span><strong>Consumer-prelude SDK</strong>Packaging, checking, and documenting a prelude outside this repository.</span><em>roadmap</em></li>
</ul>
</div>
</section>

<section class="fh-section" aria-labelledby="examples-heading">
<div class="fh-section__head">
<p class="fh-label">Examples</p>
<h2 id="examples-heading">See the compiler show its work.</h2>
<p>Edit the source and step through each compiler pass in your browser. Preview examples label any output that comes from a stored golden.</p>
</div>
<div class="fh-examples">
<a href="/playground/demo/entities" target="_self"><span>Domain languages</span><strong>Keywords are library code</strong><small>A prelude defines <code>entity</code>; the source elaborates into typed IR.</small><b>Open example →</b></a>
<a href="/playground/demo/contracts" target="_self"><span>Domain languages</span><strong>The type says what code can do</strong><small>Drop a capability from the signature and watch the typechecker reject it.</small><b>Open example →</b></a>
<a href="/playground/demo/full-pipeline" target="_self"><span>The core language</span><strong>The complete pipeline</strong><small>Read, expand, typecheck, eval, and a live JSON target for one program.</small><b>Open example →</b></a>
<a href="/workbench/demo/" target="_self"><span>Structural editing</span><strong>The outline is the program</strong><small>Edit an onboarding workflow with live values and types, a source pane, and assistant proposals you can review.</small><b>Open the workbench →</b></a>
</div>
<a class="fh-link" href="/playground/demo" target="_self">All examples →</a>
</section>

<section class="fh-section" aria-labelledby="compare-heading">
<div class="fh-section__head">
<p class="fh-label">Alternatives</p>
<h2 id="compare-heading">Where Forma fits.</h2>
<p>Each common approach covers some of this well. Forma's bet is covering all of it in one small language.</p>
</div>
<div class="fh-table">

| | New domain forms | Checking | Output | Trade-off |
| --- | --- | --- | --- | --- |
| **YAML/JSON + a generator** | No, the format is fixed | Schema validation | Whatever the templates emit | Errors surface in generated code |
| **Config languages** (CUE, Pkl, Dhall, Nickel) | Functions and schemas, not new forms | Strong, for data | JSON, YAML, and other data | No effect or capability tracking |
| **Racket `#lang`** | Yes, full language construction | Whatever you build; Typed Racket is separate | Programs on the Racket runtime | Hard to embed in a TypeScript or browser stack |
| **TypeScript builder DSLs** | Functions and objects | TypeScript's types | Runtime objects in one host | The DSL is the host program, so it's hard to review, sandbox, or port |
| **Forma** | `form` descriptors in preludes | Hindley–Milner inference, descriptor validation, effect sets | Typed IR (`application/vnd.forma.ir+json`), Effect TypeScript | Pre-alpha, with one generated target so far |

</div>
</section>

<section class="fh-section" aria-labelledby="embed-heading">
<div class="fh-section__head">
<p class="fh-label">Engine</p>
<h2 id="embed-heading">Built to embed.</h2>
<p>One TypeScript engine runs behind a JSON host ABI in Node, the browser, and editor tooling, and stored fixtures pin its behavior.</p>
</div>
<div class="fh-facts">
<article><h3>TypeScript engine</h3><p><code>@formalang/ts</code> on npm. Runs in Node and in the browser; the workbench above runs it in a Web Worker.</p></article>
<article><h3>Host and CLI</h3><p><code>@formalang/host</code> wraps the engine in a JSON host ABI, with a source-built <code>forma</code> JSON CLI and daemon.</p></article>
<article><h3>Conformance</h3><p>Fixtures and reviewed goldens pin parsing, typing, evaluation, and IR output, and CI checks the engine against them.</p></article>
<article><h3>Editor tooling</h3><p>A language server plus CodeMirror and React components for diagnostics, hover, and structural editing.</p></article>
</div>
</section>

<section class="fh-section" aria-labelledby="status-heading">
<div class="fh-section__head">
<p class="fh-label">Before you bet on it</p>
<h2 id="status-heading">Pre-alpha research, with honest edges.</h2>
</div>
<div class="fh-notes-grid">
<dl class="fh-notes">
<div><dt>It is pre-alpha research.</dt><dd>Packages are 0.x and change without notice. There are no stable APIs, wire formats, or host ABI yet.</dd></div>
<div><dt>There is no published CLI.</dt><dd>You call the engine from your own build script. A consumer-prelude SDK is next on the <a href="/roadmap">roadmap</a>.</dd></div>
<div><dt>Some browser output is stored.</dt><dd>The playground does not run ontology elaboration yet; those examples show a stored canonical IR golden, originally captured from the retired OCaml engine.</dd></div>
<div><dt>One generated target.</dt><dd>Effect TypeScript and Effect Schema are generated today. Rust and OCaml generation are research directions, not built.</dd></div>
</dl>

<pre class="fh-ascii fh-ascii--card" v-pre aria-label="Working today: lossless reader and formatter, macros, Hindley–Milner and effect inference, canonical IR, Effect TypeScript and Schema generation, the browser playground and language server, and conformance goldens. Not yet: a published forma CLI, a stable host ABI, a consumer-prelude SDK, and Rust or OCaml code generation.">working today
<span class="tone-ok">✓</span> reader · formatter · macros
<span class="tone-ok">✓</span> HM inference · effect inference
<span class="tone-ok">✓</span> canonical IR
<span class="tone-ok">✓</span> Effect TypeScript + Schema
<span class="tone-ok">✓</span> playground · language server
<span class="tone-ok">✓</span> conformance goldens

not yet
<span class="tone-muted">○</span> published CLI
<span class="tone-muted">○</span> stable host ABI
<span class="tone-muted">○</span> consumer-prelude SDK
<span class="tone-muted">○</span> Rust / OCaml codegen</pre>

</div>
<div class="fh-columns">
<div class="fh-list fh-list--yes">
<h3>A good fit</h3>
<ul>
<li>Your schemas, endpoints, workflows, or policies are spread across files that drift.</li>
<li>You're building a domain language and want typed extensions, real diagnostics, and inspectable passes instead of a hand-rolled parser.</li>
<li>Reviewers need to see what authored code can fail with and what it can touch.</li>
</ul>
</div>
<div class="fh-list fh-list--no">
<h3>Not a fit yet</h3>
<ul>
<li>General application programming. Forma isn't trying to replace Clojure, OCaml, or TypeScript.</li>
<li>Numeric or throughput-critical code.</li>
<li>Teams that need stable APIs, wire formats, or a CLI today.</li>
</ul>
</div>
</div>
</section>

<section class="fh-family" aria-labelledby="family-heading">
<div class="fh-family__head">
<div>
<p class="fh-label">Part of the WorldVM family</p>
<h2 id="family-heading">Small experiments. Bigger worlds.</h2>
</div>
<p>Forma is one thread in a family of open experiments in software that can describe, remember, coordinate, and explain itself. WorldVM is where they meet: a runtime for operational worlds of entities, rules, goals, and actions.</p>
</div>
<ul class="fh-family__grid">
<li><a class="no-icon" href="https://triplex.build"><strong>Triplex ↗</strong><em>A memory for your world.</em><span>An embedded fact database that keeps time, rules, and provenance together.</span></a></li>
<li><a class="no-icon" href="https://schematics.run"><strong>Schematics ↗</strong><em>Let your schemas tell you more.</em><span>Small Effect libraries that pull an app's hidden program out into data.</span></a></li>
<li><a class="no-icon" href="https://foldworks.dev"><strong>Foldworks ↗</strong><em>Give the machinery a face.</em><span>Components and application primitives for Foldkit.</span></a></li>
<li><a class="no-icon" href="https://github.com/bjacobso/runfold"><strong>Runfold ↗</strong><em>Work that keeps unfolding.</em><span>Typed programs as data, for durable and inspectable work.</span></a></li>
<li class="fh-family__here"><div><strong>Forma</strong><em>Little language. Big ideas.</em><span>You are here: a typed Lisp for building domain-specific languages.</span></div></li>
</ul>
<a class="fh-family__cta no-icon" href="https://worldvm.com/">Meet the whole family at worldvm.com ↗</a>
</section>

</div>
