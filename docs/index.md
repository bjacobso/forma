---
layout: home
title: Forma
titleTemplate: false
description: Forma is a typed Lisp for building your own domain language. Define the keywords as library code; the compiler checks programs that use them and emits typed artifacts.
sidebar: false
aside: false
pageClass: forma-index
---

<div class="forma-home">

<header class="fh-hero" aria-labelledby="hero-title">
<div class="fh-blueprint" aria-hidden="true"></div>
<div class="fh-hero__copy">
<p class="fh-eyebrow"><span class="fh-dot"></span>A typed Lisp for domain languages · pre-alpha</p>
<div class="fh-wordmark" aria-hidden="true"><span>(</span>forma<span>)</span></div>
<h1 id="hero-title">Build your own typed domain language.</h1>
<p class="fh-lead">Forma is a small typed Lisp. You define domain keywords like <code>entity</code> or <code>service</code> as library code. The compiler checks programs that use them, reports errors at the line you wrote, and emits typed artifacts that other systems consume.</p>
<p class="fh-detail">Your vocabulary. A checked core. <strong>One source</strong> instead of six files that drift.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="#live">Edit it live <span aria-hidden="true">↓</span></a>
<a class="fh-button" href="#how-it-works">How it works</a>
</div>
</div>
<div class="fh-hero__side">
<div class="fh-window fh-window--art">
<div class="fh-window__bar" aria-hidden="true"><span class="fh-window__dots"><i></i><i></i><i></i></span><span>schema.lisp — five passes</span></div>

<pre class="fh-ascii" v-pre aria-label="One entity form travels through five compiler passes: read keeps a lossless syntax tree, expand rewrites macros to core forms, infer assigns Hindley–Milner types and effect sets, elaborate runs the form's descriptor hooks to check its slots, and emit produces typed IR and Effect TypeScript."><span class="fh-ascii__code">(entity Employee
  {:name   String
   :active Bool})</span>
   │
   ├─ <b>read</b>       lossless syntax tree
   ├─ <b>expand</b>     macros → core forms
   ├─ <b>infer</b>      types + effect sets
   ├─ <b>elaborate</b>  descriptor checks slots <span class="tone-ok">✓</span>
   └─ <b>emit</b>       typed IR · Effect TS</pre>

</div>
<p class="fh-hero__note">↓ the real compiler, running in this page · <a href="#live">try it</a></p>
</div>
</header>

<section id="live" class="fh-live" aria-label="Live workbench">
<div class="fh-hero__demo">

<WorkbenchEmbed example="contracts" file="log.forma" title="Live contract workbench: edit, infer, and generate Effect TypeScript" />

</div>
<p class="fh-caption">Edit real source. <strong>Watch typing</strong> removes a requirement, pauses on the compiler's red underline, and types the repair. Inferred contracts, diagnostics, typed IR, and Effect TypeScript all come from the source in this editor. Switch examples to explore inference and macro expansion.</p>
</section>

<section class="fh-section" aria-labelledby="problem-heading">
<div class="fh-section__head">
<p class="fh-label"><span>00</span> The hidden model</p>
<h2 id="problem-heading">Your domain model lives in six places.</h2>
<p>Entities in JSON Schema. Endpoints in OpenAPI. Types in TypeScript. Failures nobody declared. The glue in a code generator nobody wants to touch. Every copy drifts, and when something breaks, the error points at generated code instead of the decision someone made. <strong>Each of those becomes a form.</strong></p>
</div>
<ol class="fh-xray" aria-label="Where a domain model usually hides, and the Forma form that replaces each part">
<li class="fh-xray__root" aria-hidden="true">your-app/</li>
<li class="fh-tone-teal"><a href="#how-it-works"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">schema/employee.json</span><code>"required": ["name", "department"]</code><span class="fh-xray__kind">← an entity</span><span class="fh-xray__form">entity</span></a></li>
<li class="fh-tone-teal"><a href="#how-it-works"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">openapi.yaml</span><code>/employees: get: parameters: …</code><span class="fh-xray__kind">← a query</span><span class="fh-xray__form">query</span></a></li>
<li class="fh-tone-blue"><a href="#contract-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">types.ts</span><code>interface Employee { … } // copy #3</code><span class="fh-xray__kind">← a type</span><span class="fh-xray__form">type</span></a></li>
<li class="fh-tone-red"><a href="#errors-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">handlers/log.ts</span><code>throw new Error("console down")</code><span class="fh-xray__kind">← a failure</span><span class="fh-xray__form">error</span></a></li>
<li class="fh-tone-blue"><a href="#contract-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">lib/console.ts</span><code>import { print } from "./anywhere"</code><span class="fh-xray__kind">← a capability</span><span class="fh-xray__form">service</span></a></li>
<li class="fh-tone-violet"><a href="#how-it-works"><span class="fh-xray__branch" aria-hidden="true">└──</span><span class="fh-xray__file">codegen/*.hbs</span><code v-pre>{{#each fields}} // owner left</code><span class="fh-xray__kind">← a generator</span><span class="fh-xray__form">form</span></a></li>
</ol>
</section>

<section id="how-it-works" class="fh-spread fh-tone-teal" aria-labelledby="library-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">01</span>
<div>
<p class="fh-spread__kicker">Extension</p>
<h2 id="library-heading" class="fh-spread__name"><span>(</span>form<span> …)</span></h2>
</div>
<span class="fh-status">OCaml engine · pinned output in the browser</span>
</header>
<div class="fh-spread__body">
<div class="fh-spread__story">
<p class="fh-spread__title">The keyword is library code.</p>
<div class="fh-story">
<span class="fh-story__label">The template nobody owns</span>
<p>Adding one field to <code>Employee</code> means editing a JSON Schema, an OpenAPI spec, a TypeScript interface, and a Handlebars template whose author left two years ago.</p>
</div>
<p class="fh-spread__does"><code>entity</code> is not built into the compiler. A prelude describes it with <code>form</code>: its slots, the name it binds, its result type, and the hook that constructs its output. Swap the prelude and you have a different language on the same checked core.</p>
<ol class="fh-steps">
<li><strong>Define the form.</strong> A descriptor in a prelude teaches the compiler a new keyword.</li>
<li><strong>Write in it.</strong> Authors use the keyword like any built-in.</li>
<li><strong>Get an artifact.</strong> Elaboration validates each use and constructs typed IR.</li>
</ol>
</div>
<div class="fh-window">
<div class="fh-window__bar"><span>preludes/ontology.lisp</span><span>the definition</span></div>

<<< @/snippets/home/define-entity.lisp{6,18,24,31}

<div class="fh-window__bar fh-window__bar--run"><span>▶ schema.lisp</span><span>the use</span></div>

<<< @/snippets/home/entities.lisp

</div>
</div>
<p class="fh-note">The elaboration hooks resolve <code>Employee</code>, check that <code>:where</code> is boolean, and project the selected fields into typed IR. The same prelude machinery could describe endpoints, policies, workflows, or UI instead. <a href="/playground/demo/entities" target="_self">Open this example →</a></p>
</section>

<section id="contracts" class="fh-spread fh-tone-blue" aria-labelledby="contract-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">02</span>
<div>
<p class="fh-spread__kicker">Contracts</p>
<h2 id="contract-heading" class="fh-spread__name">Effect&lt;A, E, R&gt;</h2>
</div>
<span class="fh-status is-live">Live · TypeScript engine</span>
</header>
<div class="fh-spread__body">
<div class="fh-spread__story">
<p class="fh-spread__title">The type says what the code can do.</p>
<div class="fh-story">
<span class="fh-story__label">The code review</span>
<p>A one-line change makes a helper print to the console. The diff looks harmless. Nobody can see that the function now depends on a service that can fail.</p>
</div>
<p class="fh-spread__does">Operations infer <code>Effect&lt;A, E, R&gt;</code>. A reviewer reads one line instead of a call graph:</p>
<dl class="fh-effect">
<div><dt>A</dt><dd>the value it returns</dd></div>
<div><dt>E</dt><dd>every failure it can raise, as a closed set</dd></div>
<div><dt>R</dt><dd>every capability it touches, as a closed set</dd></div>
</dl>
<p class="fh-spread__does">The contract survives code generation: requirements are lowered to <code>Context</code> services in the generated Effect TypeScript. <a href="/effect">Building with Effect? Read what Forma adds, and what it costs →</a></p>
</div>
<div class="fh-window fh-window--tabs">

::: code-group

<<< @/snippets/home/log.lisp [log.lisp]

<<< @/snippets/home/log.type.txt [inferred type]

<<< @/snippets/home/log.ts [generated.ts]

:::

</div>
</div>
</section>

<section id="diagnostics" class="fh-spread fh-tone-red" aria-labelledby="errors-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">03</span>
<div>
<p class="fh-spread__kicker">Diagnostics</p>
<h2 id="errors-heading" class="fh-spread__name">log.forma:8</h2>
</div>
<span class="fh-status is-live">Live · Effect checker</span>
</header>
<div class="fh-spread__body fh-spread__body--stack">
<div class="fh-spread__story fh-spread__story--wide">
<p class="fh-spread__title">Forget a capability, and it won't compile.</p>
<div class="fh-story">
<span class="fh-story__label">The generated stack trace</span>
<p><code>tsc</code> fails on line 412 of <code>generated.ts</code>. The mistake was a missing entry in a YAML file three directories away, and the error never mentions it.</p>
</div>
<p class="fh-spread__does">Here the body calls <code>Console.print</code>, but the signature declares no requirements. The Effect checker rejects the operation and points at the call you wrote. Click the problem to jump to its source, then add <code>Console.print</code> to the signature, or press Reset, and generation resumes.</p>
</div>

<WorkbenchEmbed example="contracts" file="log.forma" broken title="A live missing-capability error" />

</div>
</section>

<section class="fh-blueprint-section" aria-labelledby="ambition-heading">
<div class="fh-blueprint-section__inner">
<div class="fh-section__head">
<p class="fh-label"><span>04</span> The ambition</p>
<h2 id="ambition-heading">One descriptor.<br>Every tool.</h2>
<p>The same program can be source, an outline, or a domain view. A form's descriptor already teaches the compiler its checks and the structural workbench its slots. The ambition is to make a new domain language feel as well supported as a built-in one.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="/workbench/demo/" target="_self">Try the outline</a>
<a class="fh-button" href="/workbench-vision">Read the workbench vision</a>
</div>
</div>
<div class="fh-blueprint-art">

<pre class="fh-ascii" v-pre aria-label="A workflow prelude defines step and workflow forms. The compiler uses the descriptors to check slots, types, and effect sets. The workbench uses them for completions, slot placeholders, and an outline view. Proposals become tree diffs with analyzed consequences. The output is typed IR and Effect TypeScript.">preludes/workflow.lisp — one descriptor, many readers
┌──────────────────────────────────────────────────────
│ <b>(form step …)</b>   slots  :system · :reads · :writes
│
├──▶ <b>compiler</b>     slot checks · HM types · effect sets
├──▶ <b>editor</b>       completions · slot placeholders · outline
├──▶ <b>reviewer</b>     proposals as tree diffs, with consequences
└──▶ <b>artifacts</b>    typed IR · Effect TypeScript
└──────────────────────────────────────────────────────

(step background-check :system "Checkr"
  :reads [:identity] :writes [:check])</pre>

</div>
</div>
<div class="fh-callout">
<div>
<p class="fh-label">Bonus round</p>
<h3>The outline is the program.</h3>
<p>The structural workbench edits an onboarding workflow as rows and as source at the same time, with live values and types, descriptor placeholders, and assistant proposals you review as tree diffs. It pauses for approval before simulated capabilities run.</p>
</div>
<a class="fh-button fh-button--primary" href="/workbench/demo/" target="_self">Open the workbench →</a>
</div>
</section>

<section class="fh-section" aria-labelledby="compare-heading">
<div class="fh-section__head">
<p class="fh-label"><span>05</span> Alternatives</p>
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
<p class="fh-label"><span>06</span> Engines</p>
<h2 id="embed-heading">Built to embed.</h2>
<p>Two engines implement one language behind one JSON host ABI, and shared fixtures keep them honest.</p>
</div>
<div class="fh-notes-grid">
<div class="fh-facts fh-facts--two">
<article><h3>TypeScript engine</h3><p><code>@formalang/ts</code> on npm. Runs in Node and in the browser; the workbench above runs it in a Web Worker.</p></article>
<article><h3>OCaml engine</h3><p>Builds to native code, JavaScript, and WebAssembly behind the same JSON host ABI.</p></article>
<article><h3>Conformance</h3><p>Shared fixtures pin the behavior both engines must agree on, and a parity runner reports differences.</p></article>
<article><h3>Editor tooling</h3><p>A language server plus CodeMirror and React components for diagnostics, hover, and structural editing.</p></article>
</div>

<pre class="fh-ascii fh-ascii--card" v-pre aria-label="Architecture: source goes to either the TypeScript engine, which runs in Node and the browser, or the OCaml engine, which builds to native, JavaScript, and WebAssembly. Both sit behind the JSON host ABI, which the language server and workbench use. Conformance fixtures and a parity runner check both engines.">            source.lisp
        ┌────────┴────────┐
  <b>@formalang/ts</b>       <b>OCaml engine</b>
  node · browser    native · js · wasm
        └────────┬────────┘
          <b>JSON host ABI</b>
        ┌────────┴────────┐
  language server     workbench

  conformance fixtures ──▶ parity
  runner checks both engines agree</pre>

</div>
</section>

<section class="fh-section" aria-labelledby="status-heading">
<div class="fh-section__head">
<p class="fh-label"><span>07</span> Before you bet on it</p>
<h2 id="status-heading">What you should know first.</h2>
</div>
<div class="fh-notes-grid">
<dl class="fh-notes">
<div><dt>It is pre-alpha research.</dt><dd>Packages are 0.x and change without notice. There are no stable APIs, wire formats, or host ABI yet.</dd></div>
<div><dt>There is no CLI.</dt><dd>You call the engines from your own build script. A consumer-prelude SDK is next on the <a href="/roadmap">roadmap</a>.</dd></div>
<div><dt>The engines differ today.</dt><dd>The TypeScript engine does not elaborate ontology forms yet; the playground shows the OCaml engine's pinned output for those examples.</dd></div>
<div><dt>One generated target.</dt><dd>Effect TypeScript and Effect Schema are generated today. Rust and OCaml generation are research directions, not built.</dd></div>
</dl>

<pre class="fh-ascii fh-ascii--card" v-pre aria-label="Working today: lossless reader and formatter, macros, Hindley–Milner and effect inference, canonical IR from the OCaml engine, Effect TypeScript and Schema generation, the browser playground and language server, and cross-engine conformance. Not yet: a forma CLI, a stable host ABI, a consumer-prelude SDK, and Rust or OCaml code generation.">working today
<span class="tone-ok">✓</span> reader · formatter · macros
<span class="tone-ok">✓</span> HM inference · effect inference
<span class="tone-ok">✓</span> canonical IR (OCaml engine)
<span class="tone-ok">✓</span> Effect TypeScript + Schema
<span class="tone-ok">✓</span> playground · language server
<span class="tone-ok">✓</span> cross-engine conformance

not yet
<span class="tone-muted">○</span> forma CLI
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

<section class="fh-section" aria-labelledby="examples-heading">
<div class="fh-section__head">
<p class="fh-label"><span>08</span> Examples</p>
<h2 id="examples-heading">See the compiler show its work.</h2>
<p>Edit the source and step through each compiler pass in your browser. Preview examples label any output pinned from the OCaml engine.</p>
</div>
<div class="fh-examples">
<a class="fh-tone-teal" href="/playground/demo/entities" target="_self"><span>Domain languages · 01</span><strong>Keywords are library code</strong><small>A prelude defines <code>entity</code>; the source elaborates into typed IR.</small><b>Open example →</b></a>
<a class="fh-tone-blue" href="/playground/demo/contracts" target="_self"><span>Domain languages · 02</span><strong>The type says what code can do</strong><small>Drop a capability from the signature and watch the typechecker reject it.</small><b>Open example →</b></a>
<a class="fh-tone-red" href="/playground/demo/full-pipeline" target="_self"><span>The core language</span><strong>The complete pipeline</strong><small>Read, expand, typecheck, eval, and a live JSON target for one program.</small><b>Open example →</b></a>
<a class="fh-tone-violet" href="/workbench/demo/" target="_self"><span>Structural editing</span><strong>The outline is the program</strong><small>Edit an onboarding workflow with live values and types, a source pane, and assistant proposals you can review.</small><b>Open the workbench →</b></a>
</div>
<a class="fh-link" href="/playground/demo" target="_self">All examples →</a>
</section>

<section class="fh-closing" aria-labelledby="closing-heading">
<h2 id="closing-heading">Build a language on a checked core.</h2>
<p>Start with the entity example, then read how preludes and descriptors work.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="/playground/demo/entities" target="_self">Open the playground</a>
<a class="fh-button" href="/language">Read the language guide</a>
<a class="fh-button" href="https://github.com/bjacobso/forma-lang">GitHub</a>
</div>
</section>

<section class="fh-family" aria-labelledby="family-heading">
<div class="fh-family__head">
<div>
<p class="fh-label"><span>09</span> Part of the WorldVM family</p>
<h2 id="family-heading">Small experiments. Bigger worlds.</h2>
</div>
<p>Forma is one thread in a family of open experiments in software that can describe, remember, coordinate, and explain itself. WorldVM is where they meet: a runtime for operational worlds of entities, rules, goals, and actions.</p>
</div>
<ul class="fh-family__grid">
<li style="--project-color: #edba73"><a class="no-icon" href="https://triplex.build"><span class="fh-family__swatch" aria-hidden="true"></span><strong>Triplex ↗</strong><em>A memory for your world.</em><span>An embedded fact database that keeps time, rules, and provenance together.</span></a></li>
<li style="--project-color: #e2d6b4"><a class="no-icon" href="https://schematics.run"><span class="fh-family__swatch" aria-hidden="true"></span><strong>Schematics ↗</strong><em>Let your schemas tell you more.</em><span>Small Effect libraries that pull an app's hidden program out into data.</span></a></li>
<li style="--project-color: #9dbbbb"><a class="no-icon" href="https://foldworks.dev"><span class="fh-family__swatch" aria-hidden="true"></span><strong>Foldworks ↗</strong><em>Give the machinery a face.</em><span>Components and application primitives for Foldkit.</span></a></li>
<li style="--project-color: #e9a08b"><a class="no-icon" href="https://github.com/bjacobso/runfold"><span class="fh-family__swatch" aria-hidden="true"></span><strong>Runfold ↗</strong><em>Work that keeps unfolding.</em><span>Typed programs as data, for durable and inspectable work.</span></a></li>
<li class="fh-family__here" style="--project-color: #c6bed9"><div><span class="fh-family__swatch" aria-hidden="true"></span><strong>Forma</strong><em>Little language. Big ideas.</em><span>You are here: a typed Lisp for building domain-specific languages.</span></div></li>
</ul>
<a class="fh-family__cta no-icon" href="https://worldvm.com/">Meet the whole family at worldvm.com ↗</a>
</section>

</div>
