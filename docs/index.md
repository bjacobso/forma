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

<header class="fh-hero">
<div class="fh-hero__copy">
<p class="fh-eyebrow"><span class="fh-dot"></span>Pre-alpha research · MIT licensed</p>
<h1>Build your own typed domain language.</h1>
<p class="fh-lead">Forma is a small typed Lisp. You define domain keywords like <code>entity</code> or <code>define</code> as library code. The compiler checks programs that use them, reports errors at the line you wrote, and emits typed artifacts that other systems consume.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="/playground/demo/entities" target="_self">Try it in the playground</a>
<a class="fh-button" href="#how-it-works">How it works</a>
</div>
<p class="fh-passes" aria-label="Compiler passes"><span>read</span><span>expand</span><span>infer</span><span>elaborate</span><span>emit</span></p>
</div>
<div class="fh-hero__demo">

::: code-group

<<< @/snippets/home/entities.lisp [schema.lisp]

<<< @/snippets/home/entities.ir.json [ir.json]

:::

<p class="fh-caption">The <strong>ir.json</strong> tab is real compiler output: the declarations the OCaml engine emits for this source, pinned by a <a href="https://github.com/bjacobso/forma-lang/tree/main/conformance/fixtures/canonical-ir">conformance fixture</a> that CI checks.</p>
</div>
</header>

<section class="fh-problem" aria-labelledby="problem-heading">
<p class="fh-label">The problem</p>
<h2 id="problem-heading">Your domain model lives in six places.</h2>
<p>Entities in JSON Schema. Endpoints in OpenAPI. Types in TypeScript. Permissions in YAML. The glue in a code generator nobody wants to touch. Every copy drifts, and when something breaks, the error points at generated code instead of the decision someone made.</p>
<div class="fh-scatter" aria-hidden="true">
<span>schema.json</span><span>openapi.yaml</span><span>types.ts</span><span>policy.yaml</span><span>codegen.hbs</span><span>glue.ts</span>
<b>→</b>
<strong>domain.lisp</strong>
</div>
<p>Forma gives that model one typed source, written in a vocabulary you define.</p>
</section>

<section id="how-it-works" class="fh-section" aria-labelledby="library-heading">
<div class="fh-section__head">
<p class="fh-label">01 · Extension</p>
<h2 id="library-heading">The keyword is library code.</h2>
<p><code>entity</code> is not built into the compiler. A prelude describes it with <code>form</code>: its slots, the name it binds, its result type, and the hook that constructs its output. Swap the prelude and you have a different language on the same checked core.</p>
</div>
<ol class="fh-steps">
<li><strong>Define the form.</strong> A descriptor in a prelude teaches the compiler a new keyword.</li>
<li><strong>Write in it.</strong> Authors use the keyword like any built-in.</li>
<li><strong>Get an artifact.</strong> Elaboration validates each use and constructs typed IR.</li>
</ol>
<div class="fh-pair">
<div>
<p class="fh-file">preludes/ontology.lisp · the definition</p>

<<< @/snippets/home/define-entity.lisp{6,18,24,31}

</div>
<div>
<p class="fh-file">schema.lisp · the use</p>

<<< @/snippets/home/entities.lisp

<p class="fh-note">The elaboration hooks resolve <code>Employee</code>, check that <code>:where</code> is boolean, and project the selected fields into the artifact at the top of this page. The same prelude machinery could describe endpoints, policies, workflows, or UI instead.</p>
</div>
</div>
</section>

<section class="fh-section" aria-labelledby="contract-heading">
<div class="fh-split">
<div class="fh-split__copy">
<p class="fh-label">02 · Contracts</p>
<h2 id="contract-heading">The type says what the code can do.</h2>
<p>Operations infer <code>Effect&lt;A, E, R&gt;</code>. A reviewer reads one line instead of a call graph:</p>
<dl class="fh-effect">
<div><dt>A</dt><dd>the value it returns</dd></div>
<div><dt>E</dt><dd>every failure it can raise, as a closed set</dd></div>
<div><dt>R</dt><dd>every capability it touches, as a closed set</dd></div>
</dl>
<p>The contract survives code generation: the Effect TypeScript tab is generated from the same declarations, with requirements lowered to <code>Context</code> services.</p>
<a class="fh-link" href="/playground/demo/contracts" target="_self">Edit this contract live →</a>
<a class="fh-link" href="/effect">Building with Effect? Read what Forma adds, and what it costs →</a>
</div>
<div class="fh-split__demo">

::: code-group

<<< @/snippets/home/log.lisp [log.lisp]

<<< @/snippets/home/log.type.txt [inferred type]

<<< @/snippets/home/log.ts [generated.ts]

:::

</div>
</div>
</section>

<section class="fh-section" aria-labelledby="errors-heading">
<div class="fh-section__head">
<p class="fh-label">03 · Diagnostics</p>
<h2 id="errors-heading">Forget a capability, and it won't compile.</h2>
<p>Here the body calls <code>Console.print</code>, but the signature declares no requirements. The typechecker rejects the operation and the diagnostic's span points at the author's <code>define</code> form, not at generated code. Macro expansion keeps the same provenance.</p>
</div>
<div class="fh-pair">
<div>
<p class="fh-file">log.lisp · signature missing <code>Console.print</code></p>

<<< @/snippets/home/log-undeclared.lisp{8-9} [log.lisp]

</div>
<div>
<p class="fh-file">typecheck diagnostic · verbatim engine output</p>

<<< @/snippets/home/log-undeclared.diagnostic.json

<p class="fh-note">The wording is still pre-alpha. The check and the span are real, and they run in your browser in the <a href="/playground/demo/contracts" target="_self">contracts demo</a>.</p>
</div>
</div>
</section>

<section class="fh-section" aria-labelledby="compare-heading">
<div class="fh-section__head">
<p class="fh-label">04 · Alternatives</p>
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
<p class="fh-label">05 · Engines</p>
<h2 id="embed-heading">Built to embed.</h2>
</div>
<div class="fh-facts">
<article><h3>TypeScript engine</h3><p><code>@formalang/ts</code> on npm. Runs in Node and in the browser; the playground runs it in a Web Worker.</p></article>
<article><h3>OCaml engine</h3><p>Builds to native code, JavaScript, and WebAssembly behind the same JSON host ABI.</p></article>
<article><h3>Conformance</h3><p>Shared fixtures pin the behavior both engines must agree on, and a parity runner reports differences.</p></article>
<article><h3>Editor tooling</h3><p>A language server plus CodeMirror and React components for diagnostics, hover, and structural editing.</p></article>
</div>
</section>

<section class="fh-section" aria-labelledby="fit-heading">
<div class="fh-section__head">
<p class="fh-label">06 · Audience</p>
<h2 id="fit-heading">Who it's for.</h2>
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

<section class="fh-section" aria-labelledby="status-heading">
<div class="fh-section__head">
<p class="fh-label">07 · Status</p>
<h2 id="status-heading">What exists today.</h2>
</div>
<div class="fh-columns">
<div class="fh-list fh-list--yes">
<h3>Working</h3>
<ul>
<li>Lossless reader, formatter, macros, Hindley–Milner inference, and effect inference</li>
<li>Canonical IR emission from the OCaml engine</li>
<li>Effect TypeScript and Effect Schema generation from the TypeScript engine</li>
<li>Browser playground, language server, and cross-engine conformance suites</li>
</ul>
</div>
<div class="fh-list fh-list--no">
<h3>Not yet</h3>
<ul>
<li>No <code>forma</code> CLI. Packages are 0.x and change without notice.</li>
<li>The TypeScript engine does not elaborate ontology forms yet; the playground shows the OCaml engine's pinned output.</li>
<li>A consumer-prelude SDK and a stable host ABI are next on the roadmap.</li>
<li>Rust and OCaml code generation are research directions, not built.</li>
</ul>
</div>
</div>
<a class="fh-link" href="/roadmap">Read the roadmap →</a>
</section>

<section class="fh-section" aria-labelledby="examples-heading">
<div class="fh-section__head">
<p class="fh-label">08 · Examples</p>
<h2 id="examples-heading">See the compiler show its work.</h2>
<p>Edit the source and step through each compiler pass in your browser. Preview examples label any output pinned from the OCaml engine.</p>
</div>
<div class="fh-examples">
<a href="/playground/demo/entities" target="_self"><span>Domain languages · 01</span><strong>Keywords are library code</strong><small>A prelude defines <code>entity</code>; the source elaborates into typed IR.</small><b>Open example →</b></a>
<a href="/playground/demo/contracts" target="_self"><span>Domain languages · 02</span><strong>The type says what code can do</strong><small>Drop a capability from the signature and watch the typechecker reject it.</small><b>Open example →</b></a>
<a href="/playground/demo/full-pipeline" target="_self"><span>The core language</span><strong>The complete pipeline</strong><small>Read, expand, typecheck, eval, and a live JSON target for one program.</small><b>Open example →</b></a>
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

</div>
