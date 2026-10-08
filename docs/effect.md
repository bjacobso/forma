---
layout: home
title: Forma for Effect
description: Author Effect programs in a typed Lisp that already knows what services, typed errors, and layers are. Forma checks the contracts and generates the Effect TypeScript you would write by hand. What you gain, and what you give up.
sidebar: false
aside: false
pageClass: forma-index forma-effect
---

<div class="forma-home">

<header class="fh-hero" aria-labelledby="hero-title">
<div class="fh-blueprint" aria-hidden="true"></div>
<div class="fh-hero__copy">
<p class="fh-eyebrow"><span class="fh-dot"></span>Forma for Effect 4 · pre-alpha</p>
<h1 id="hero-title">A language for writing Effect, not a library inside one.</h1>
<p class="fh-lead">If your backend is Effect from end to end, most of your code is schemas, tagged errors, services, operations, and layers. Forma makes those the language. You write them in a small typed Lisp. The compiler checks every failure and every dependency against the signature, then generates idiomatic Effect TypeScript that you could have written by hand.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="#live">Edit it live <span aria-hidden="true">↓</span></a>
<a class="fh-button" href="#what-you-give-up">Read the trade-offs first</a>
</div>
</div>
<div class="fh-hero__side">
<div class="fh-window fh-window--art">
<div class="fh-window__bar" aria-hidden="true"><span class="fh-window__dots"><i></i><i></i><i></i></span><span>orders.lisp → orders.ts</span></div>

<pre class="fh-ascii" v-pre aria-label="The Forma signature of pay declares that it returns an Order, can fail with OrderNotFound or PaymentDeclined, and requires Orders and the single method Payments.charge. It generates an Effect.Effect type with the same success, error union, and service requirements."><span class="fh-ascii__code">(: pay (-> OrderId
  (Effect Order
    [OrderNotFound PaymentDeclined]
    [Orders Payments.charge])))</span>
   │
   │  <b>read</b> → <b>project</b> → <b>check</b> → <b>generate</b>
   ▼
<span class="fh-ascii__code">Effect.Effect&lt;Order,
  OrderNotFound | PaymentDeclined,
  Orders | Payments&gt;</span></pre>

</div>
<p class="fh-hero__note">↓ the real Effect checker, running in this page · <a href="#live">try it</a></p>
</div>
</header>

<section id="live" class="fh-live" aria-label="Live workbench">
<div class="fh-hero__demo">

<WorkbenchEmbed example="orders" file="orders.forma" title="Live Effect workbench: order payments" />

</div>
<p class="fh-caption">These panes run the real Effect compiler in your browser. Edit the operation, inspect the body's inferred failures and requirements, and open <strong>Effect TypeScript</strong> to see fresh generated code. <strong>Watch typing</strong> introduces an undeclared failure and repairs it.</p>
</section>

<section class="fh-section" aria-labelledby="problem-heading">
<div class="fh-section__head">
<p class="fh-label"><span>00</span> The problem</p>
<h2 id="problem-heading">Effect is a language encoded in TypeScript.</h2>
<p>Effect gives TypeScript typed errors, dependency injection, resources, and structured concurrency. TypeScript wasn't designed for any of them, so you write the encoding. When something is wrong, the error describes the encoding (a forty-line conditional type) instead of your decision. <strong>Forma treats those constructs as the vocabulary</strong>, so the compiler can check them and talk about them in your terms.</p>
</div>
<ol class="fh-xray" aria-label="Effect encodings in TypeScript, and the Forma form that replaces each one">
<li class="fh-xray__root" aria-hidden="true">orders/</li>
<li class="fh-tone-blue"><a href="#contract-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">pay.ts</span><code>Effect.gen(function* () { yield* … })</code><span class="fh-xray__kind">← sequencing</span><span class="fh-xray__form">do!</span></a></li>
<li class="fh-tone-blue"><a href="#contract-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">services.ts</span><code>class Payments extends Context.Service&lt;Payments, …&gt;()("Payments")</code><span class="fh-xray__kind">← a service</span><span class="fh-xray__form">service</span></a></li>
<li class="fh-tone-red"><a href="#errors-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">errors.ts</span><code>class PaymentDeclined extends Schema.TaggedError&lt;…&gt;()(…)</code><span class="fh-xray__kind">← a failure</span><span class="fh-xray__form">error</span></a></li>
<li class="fh-tone-teal"><a href="#output-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">schema.ts</span><code>const Status = Schema.Literals([…]); type Status = …</code><span class="fh-xray__kind">← a type, twice</span><span class="fh-xray__form">type</span></a></li>
<li class="fh-tone-teal"><a href="#output-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">layers.ts</span><code>Layer.effect(Orders, Effect.gen(function* () { … }))</code><span class="fh-xray__kind">← wiring</span><span class="fh-xray__form">layer</span></a></li>
<li class="fh-tone-amber"><a href="#strict-heading"><span class="fh-xray__branch" aria-hidden="true">└──</span><span class="fh-xray__file">pay.ts</span><code>{ ...order, status: "paid" } satisfies Order</code><span class="fh-xray__kind">← an update</span><span class="fh-xray__form">assoc</span></a></li>
</ol>
</section>

<section id="contracts" class="fh-spread fh-tone-blue" aria-labelledby="contract-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">01</span>
<div>
<p class="fh-spread__kicker">Contracts</p>
<h2 id="contract-heading" class="fh-spread__name"><span>(</span>Effect A [E] [R]<span>)</span></h2>
</div>
<span class="fh-status is-live">Checked · TypeScript engine</span>
</header>
<div class="fh-spread__body">
<div class="fh-spread__story">
<p class="fh-spread__title">The signature is the review.</p>
<div class="fh-story">
<span class="fh-story__label">The quiet dependency</span>
<p>A refactor adds one <code>yield* Payments</code> deep inside a helper. <code>R</code> widens by inference, the PR is green, and nobody reviewing the diff sees that checkout can now charge a card.</p>
</div>
<p class="fh-spread__does">Every operation declares <code>(Effect A [Errors] [Requirements])</code>, and the checker holds the body to it:</p>
<dl class="fh-effect">
<div><dt>A</dt><dd>the value it succeeds with, checked in every branch</dd></div>
<div><dt>E</dt><dd>every failure it can raise, as a closed set</dd></div>
<div><dt>R</dt><dd>every service it touches. Requirements can name a single method, as in <code>Payments.charge</code>, which is finer than Effect's service-level <code>R</code>.</dd></div>
</dl>
<p class="fh-spread__does">A Forma program has almost no ambient I/O. Apart from logging, sleeping, and reading <code>Config</code>, it cannot fetch, read files, or call a library unless the call goes through a declared service, so the signature lists what the code can touch.</p>
</div>
<div class="fh-window">
<div class="fh-window__bar"><span>orders.lisp</span><span>declared, then checked</span></div>

<<< @/snippets/effect/orders.lisp{23,29}

</div>
</div>
</section>

<section id="diagnostics" class="fh-spread fh-tone-red" aria-labelledby="errors-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">02</span>
<div>
<p class="fh-spread__kicker">Diagnostics</p>
<h2 id="errors-heading" class="fh-spread__name">PaymentDeclined?</h2>
</div>
<span class="fh-status is-live">Live · Effect checker</span>
</header>
<div class="fh-spread__body fh-spread__body--stack">
<div class="fh-spread__story fh-spread__story--wide">
<p class="fh-spread__title">Errors at the line you wrote, in the words you used.</p>
<div class="fh-story">
<span class="fh-story__label">The forty-line type error</span>
<p><code>Type 'OrderNotFound | PaymentDeclined' is not assignable to type 'OrderNotFound'</code>, reported on the whole generated function, three assignability frames deep.</p>
</div>
<p class="fh-spread__does">Drop <code>PaymentDeclined</code> from the signature. Forma reports the mistake at the call that can raise it. TypeScript would also reject the generated code, but it reports the mismatch on the generated function, as an assignability chain. Click the problem to reveal the call that introduces it, then add the error back or press Reset, and generated TypeScript becomes available again.</p>
</div>

<WorkbenchEmbed example="orders" file="orders.forma" broken title="Live undeclared PaymentDeclined diagnostic" />

</div>
</section>

<section id="strict" class="fh-spread fh-tone-amber" aria-labelledby="strict-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">03</span>
<div>
<p class="fh-spread__kicker">Stricter where it matters</p>
<h2 id="strict-heading" class="fh-spread__name">tsc: 0 errors</h2>
</div>
<span class="fh-status is-live">Checked · Effect checker</span>
</header>
<div class="fh-spread__story fh-spread__story--wide">
<p class="fh-spread__title">Some bugs TypeScript lets through.</p>
<div class="fh-story">
<span class="fh-story__label">The truthy zero</span>
<p>An order total of <code>0</code> skips the receipt because <code>if (total)</code> is false. <code>tsc</code> accepts it, and so does every reviewer who has read a thousand lines like it.</p>
</div>
<p class="fh-spread__does">Forma rejects these four, and <code>tsc</code> accepts all of them: records compared by reference, an object interpolated into a string, a fraction stored in an <code>Int</code>, and JavaScript truthiness in a condition. Forma also requires exhaustive <code>match</code>, rejects catches for errors that can't happen and finalizers that can fail, and stops a constant from reading another before it is initialized. TypeScript catches some of these in the generated code, but not all of them, and never at the Forma line.</p>
</div>
<div class="fh-pair fh-pair--spread">
<div>
<p class="fh-file">strict.lisp</p>

<<< @/snippets/effect/strict.lisp

</div>
<div>
<p class="fh-file">Forma</p>

<<< @/snippets/effect/strict.forma.txt

<p class="fh-file">tsc on the generated code</p>

<<< @/snippets/effect/strict.tsc.txt

</div>
</div>
</section>

<section class="fh-section" aria-labelledby="output-heading">
<div class="fh-section__head">
<p class="fh-label"><span>04</span> Output</p>
<h2 id="output-heading">Plain Effect out. No runtime, no lock-in.</h2>
<p>The single-file generator imports <code>effect</code>; the file-module linker also emits real imports between generated files. It contains <code>Schema</code> constants, <code>Schema.TaggedError</code> and <code>Schema.Class</code> classes, <code>Context.Service</code> classes, <code>Effect.gen</code> functions, and <code>Layer</code> values that capture their dependencies. It has no <code>any</code>, no casts other than <code>as const</code>, and no non-null assertions. You review it, check it in, and run it like any other Effect code. If you stop using Forma, you keep the TypeScript.</p>
</div>
<div class="fh-facts">
<article><h3>Layers that wire themselves</h3><p>A <code>layer</code> captures the services its methods call and becomes <code>Layer.succeed</code> or <code>Layer.effect</code>, with its <code>Layer&lt;Out, E, In&gt;</code> type computed and checked.</p></article>
<article><h3>Resources and concurrency</h3><p><code>acquire-release</code>, <code>scoped</code>, <code>all</code> and <code>for-each</code> with concurrency, <code>race</code>, <code>fork</code>, <code>timeout</code>, and <code>retry</code> with schedules map to the Effect functions of the same name.</p></article>
<article><h3>Data as schemas</h3><p>Brands, enums, tagged unions, optional fields, classes, and <code>decode</code> for untrusted JSON. The runtime schema and the static type come from one declaration.</p></article>
<article><h3>One IR, two engines</h3><p>The OCaml engine projects every passing conformance program to the same IR as the TypeScript engine. The IR is an inspectable artifact, validated against payload contracts, rather than an internal detail.</p></article>
</div>
</section>

<section class="fh-section" aria-labelledby="size-heading">
<div class="fh-section__head">
<p class="fh-label"><span>05</span> Size, honestly</p>
<h2 id="size-heading">Less to write, but not ten times less.</h2>
<p>Across the conformance programs, the generated TypeScript is about 1.2 times as many lines as the Forma source, and roughly 1.4 times as many characters. Part of that is formatting. One program is longer in Forma than in TypeScript. Brevity is a side effect. The reasons to use Forma are what it checks and how it reports problems.</p>
</div>
<div class="fh-table">

<!--@include: ./snippets/effect/sizes.md-->

</div>
</section>

<section class="fh-section" aria-labelledby="proof-heading">
<div class="fh-section__head">
<p class="fh-label"><span>06</span> Evidence</p>
<h2 id="proof-heading">Every claim on this page is a test.</h2>
<p>The <a href="https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript">Effect TypeScript conformance suite</a> holds complete programs: a CRUD service with layers, a multi-service checkout, resource handling, a concurrent workflow, typed error recovery, schemas and decoding, configuration, and streams. For each one, CI checks five things:</p>
</div>
<ol class="fh-steps">
<li><strong>No diagnostics.</strong> The program elaborates cleanly.</li>
<li><strong>Exact output.</strong> The generated module matches a reviewed golden file.</li>
<li><strong>Strict types.</strong> It typechecks with <code>exactOptionalPropertyTypes</code> and <code>noUncheckedIndexedAccess</code>, with no <code>any</code> anywhere.</li>
<li><strong>A valid artifact.</strong> The IR packages under its payload contracts.</li>
<li><strong>Real behaviour.</strong> A harness runs it: resources are released in order on failure, concurrency limits are measured, and typed errors carry the right payloads.</li>
</ol>
<p>A second set of programs must be rejected, each with exact, located diagnostics. Each rejection also records whether TypeScript would have caught the same mistake. Two rounds of adversarial testing, about 200 probe programs, found roughly 30 bugs in the compiler. All of them are fixed and now covered by tests.</p>
</section>

<section id="what-you-give-up" class="fh-section" aria-labelledby="cost-heading">
<div class="fh-section__head">
<p class="fh-label"><span>07</span> The cost</p>
<h2 id="cost-heading">What you give up.</h2>
<p>Forma is a second language between you and Effect. These are the costs today, stated plainly. Some are fundamental to the approach and some are missing work.</p>
</div>
<div class="fh-columns">
<div class="fh-list fh-list--no">
<h3>Fundamental trade-offs</h3>
<ul>
<li><strong>The npm ecosystem inside your logic.</strong> Forma code cannot import TypeScript functions or types, call an npm package, or write a JavaScript callback. Anything outside the Forma vocabulary, such as HTTP clients, database drivers, crypto, dates, or <code>Effect.promise</code>, has to be a service implemented in TypeScript and provided as a layer.</li>
<li><strong>A closed vocabulary.</strong> The combinators and value functions are built into the compiler, in both engines. Pure polymorphic helpers and local macros can compose the supported forms. New <code>Effect.*</code> combinators still require compiler support; imported compile-time libraries are a later stage. That contradicts Forma's own pitch that keywords are library code, and it is not resolved.</li>
<li><strong>Two languages to learn.</strong> Your team reads Lisp, reads Effect, and reviews generated TypeScript. Debugging happens in the generated code.</li>
<li><strong>Stricter than you may want.</strong> Integral literals are <code>Int</code> (<code>0.0</code> reads as <code>0</code>, so a <code>Number</code> accumulator needs <code>(: 0 Number)</code>). Record literals widen like TypeScript's, so a schema value needs <code>(Member {...})</code>. A function cannot call a service, and <code>let</code> cannot run an effect.</li>
<li><strong>Generated code you don't style.</strong> Identifiers are camelCased (<code>get-user</code> becomes <code>getUser</code>), dashed fields stay quoted (<code>order["total-cents"]</code>), and the layout is the generator's.</li>
</ul>
</div>
<div class="fh-list fh-list--no">
<h3>Missing today</h3>
<ul>
<li><strong>Editor support for these forms.</strong> The language server runs the general HM typechecker, which doesn't understand layers, combinators, streams, or multi-clause <code>catch</code>, so editors show false errors on valid Effect programs. There is no go-to-definition from generated code back to Forma.</li>
<li><strong>Source maps.</strong> Stack traces and breakpoints point at the generated TypeScript, not at the Forma line.</li>
<li><strong>Packages.</strong> Relative file modules with explicit imports, exports, and linked Effect TypeScript are implemented. Package manifests, registries, and compile-time library imports remain proposals. See <a href="/modules">File modules</a>.</li>
<li><strong>Generics.</strong> Operations and functions have no type parameters.</li>
<li><strong>Parts of Effect.</strong> Recursive schemas (<code>Schema.suspend</code>), <code>TaggedClass</code>, transformations, <code>Queue</code>, <code>PubSub</code>, <code>Deferred</code>, <code>Semaphore</code>, scoped forks, schedule composition, <code>Effect.fn</code>, spans and tracing, and most of <code>Stream</code>. The <a href="/effect/reference">reference</a> lists what exists.</li>
<li><strong>Tooling.</strong> There is no CLI or watch mode; you call <code>generateEffectProgram</code> from your own build script. Packages are 0.x, and the output shape changed in this release.</li>
<li><strong>The hosted runtime.</strong> <code>makeMechanicsRuntime</code> interprets only the original operation forms. Run the generated TypeScript instead.</li>
</ul>
</div>
</div>
</section>

<section class="fh-section" aria-labelledby="unknown-heading">
<div class="fh-section__head">
<p class="fh-label"><span>08</span> Open questions</p>
<h2 id="unknown-heading">What hasn't been thought through yet.</h2>
<p>These go beyond missing features. They are questions with no answer yet, and they could change the design.</p>
</div>
<div class="fh-facts">
<article><h3>Adopting it gradually</h3><p>An existing Effect codebase has schemas and services in TypeScript. Forma cannot refer to them, so today you would redeclare them. There is no importer in either direction.</p></article>
<article><h3>Generated code in review</h3><p>It is undecided whether output is checked in and reviewed as a diff, or generated at build time and trusted. Each choice changes how teams review and how version upgrades land.</p></article>
<article><h3>The Effect version</h3><p>The target is exactly <code>effect@4.0.0-rc.112</code>, a release candidate. Following Effect's releases means re-validating the generator, and supporting two Effect versions at once has not been considered.</p></article>
<article><h3>The platform layer</h3><p>HTTP APIs, SQL, RPC, workers, and observability are where most Effect applications spend their code. A <a href="/effect/http-api">prelude-defined HttpApi spike</a> generates endpoints, groups, checked handlers, and a TypeScript builder DSL for Effect 4. Middleware and the broader platform surface still sit behind hand-written service layers.</p></article>
<article><h3>Testing in Forma</h3><p>Tests are TypeScript harnesses written against the generated module. Forma has no way to write tests, test layers, or property checks in Forma itself.</p></article>
<article><h3>Two checkers</h3><p>The general HM checker and the Effect checker disagree on these programs. The live embeds on this page use the Effect checker for diagnostics, body types, and generation. Convergence and language-server routing are still open.</p></article>
</div>
</section>

<section class="fh-section" aria-labelledby="fit-heading">
<div class="fh-section__head">
<p class="fh-label"><span>09</span> Fit</p>
<h2 id="fit-heading">When to choose it.</h2>
</div>
<div class="fh-columns">
<div class="fh-list fh-list--yes">
<h3>Worth trying</h3>
<ul>
<li>A new service where domain logic, error contracts, and dependency wiring dominate, and I/O sits behind a few adapters.</li>
<li>Teams that review contracts more than code and want <code>E</code> and <code>R</code> to be the review.</li>
<li>Code written by people or tools you don't fully trust. Apart from logging, sleeping, and reading config, a program can't reach anything its signature doesn't declare, and the checker explains violations at the source line.</li>
<li>Research on typed domain languages that target Effect.</li>
</ul>
</div>
<div class="fh-list fh-list--no">
<h3>Not yet</h3>
<ul>
<li>An existing Effect codebase you can't partially redeclare.</li>
<li>Code built on <code>@effect/platform</code>, SQL, RPC, or heavy npm use in business logic.</li>
<li>Libraries that need generics or custom combinators.</li>
<li>Teams that need stable tooling, editor support, and source maps today.</li>
</ul>
</div>
</div>
</section>

<section class="fh-closing" aria-labelledby="closing-heading">
<h2 id="closing-heading">Read the program, then the output.</h2>
<p>The reference maps every form to the Effect code it generates. The conformance suite has complete programs with the TypeScript they produce.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="/effect/reference">Language reference</a>
<a class="fh-button" href="https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript">Conformance suite</a>
<a class="fh-button" href="/playground/demo/effect-ts" target="_self">Playground</a>
</div>
</section>

</div>
