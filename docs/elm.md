---
layout: home
title: Forma for Elm-style apps
description: The Elm Architecture, checked from the database to the DOM. A prelude-defined Forma prototype generates Foldkit and Effect TypeScript, with exhaustive update, checked command recovery, and pure views.
sidebar: false
aside: false
pageClass: forma-index forma-elm
---

<div class="forma-home">

<header class="fh-hero" aria-labelledby="hero-title">
<div class="fh-hero__copy">
<p class="fh-eyebrow">Forma for Foldkit · pre-alpha prototype</p>
<h1 id="hero-title">The Elm Architecture, checked from the database to the DOM.</h1>
<p class="fh-lead">A message arrives. Update chooses the next model and commands. View describes the screen. Forma gives that loop a small Lisp vocabulary and checks its contracts, then generates Foldkit on Effect 4. Exhaustive update, typed command recovery, and pure view work in the TypeScript prototype today. A single API contract from server to client is the next step.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="#live">Edit a command live <span aria-hidden="true">↓</span></a>
<a class="fh-button" href="#what-you-give-up">Read the limits first</a>
</div>
</div>
<div class="fh-hero__side">
<div class="fh-window fh-window--art">
<div class="fh-window__bar" aria-hidden="true"><span class="fh-window__dots"><i></i><i></i><i></i></span><span>counter.lisp → Foldkit + Effect</span></div>
<pre class="fh-ascii" v-pre aria-label="A message goes through pure update to model and commands. Commands map success and typed failures back to messages. The model goes through pure view to the DOM."><span class="fh-ascii__code">              message
                 │
                 ▼
           <b>pure update</b>
            ╱         ╲
         model      commands
           │           │
           ▼           ▼
       <b>pure view</b>    Effect A E R
           │           │
           ▼       ok + errors
          DOM          │
                       └──→ message</span></pre>
</div>
<p class="fh-hero__note">Prelude-defined vocabulary · TypeScript engine only · <a href="/elm/reference">prototype reference</a></p>
</div>
</header>

<section id="live" class="fh-live" aria-label="Live command checker">
<div class="fh-hero__demo">

<WorkbenchEmbed example="elm-command" file="counter-command.forma" title="Live Effect workbench: counter command recovery" />

</div>
<p class="fh-caption">This embed runs the <strong>existing Effect dialect</strong>, showing the operation and recovery that underlie a command. Introduce an error to remove recovery and expose an unhandled typed failure, then restore it. The full <code>msg / command / update / view / app</code> prelude runs through <code>generateElmProgram</code> in a build script; it is not wired into the browser worker or language server.</p>
</section>

<section class="fh-section" aria-labelledby="problem-heading">
<div class="fh-section__head">
<p class="fh-label"><span>00</span> The problem</p>
<h2 id="problem-heading">The loop is simple. Its TypeScript encoding isn't.</h2>
<p>Foldkit brings the Elm Architecture to Effect: schema-backed models, messages, commands, and pure update. TypeScript expresses those through schemas, unions, factories, and function signatures. Exhaustiveness depends on how you write the matcher. Forma makes the decisions visible as application vocabulary, so mistakes can point to the source you authored.</p>
</div>
<ol class="fh-xray" aria-label="TypeScript application encodings and Forma vocabulary">
<li class="fh-xray__root" aria-hidden="true">counter/</li>
<li class="fh-tone-blue"><a href="#messages"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">message.ts</span><code>schemas + tagged union</code><span class="fh-xray__kind">← events</span><span class="fh-xray__form">msg</span></a></li>
<li class="fh-tone-red"><a href="#commands"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">command.ts</span><code>Command.define + Effect.catchTag</code><span class="fh-xray__kind">← recovery</span><span class="fh-xray__form">command</span></a></li>
<li class="fh-tone-amber"><a href="#messages"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">update.ts</span><code>every variant → model + commands</code><span class="fh-xray__kind">← transition</span><span class="fh-xray__form">with</span></a></li>
<li class="fh-tone-teal"><a href="#views"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">view.ts</span><code>HtmlBuilder + message events</code><span class="fh-xray__kind">← rendering</span><span class="fh-xray__form">view</span></a></li>
<li class="fh-tone-blue"><a href="#output"><span class="fh-xray__branch" aria-hidden="true">└──</span><span class="fh-xray__file">app.ts</span><code>Model + init + update + view</code><span class="fh-xray__kind">← wiring</span><span class="fh-xray__form">app</span></a></li>
</ol>
</section>

<section id="messages" class="fh-spread fh-tone-blue" aria-labelledby="messages-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">01</span>
<div><p class="fh-spread__kicker">Messages and update</p><h2 id="messages-heading" class="fh-spread__name"><span>(</span>with model command…<span>)</span></h2></div>
<span class="fh-status is-live">Prototype · TypeScript engine</span>
</header>
<div class="fh-spread__body">
<div class="fh-spread__story">
<p class="fh-spread__title">Adding a message creates an obligation.</p>
<p><code>msg</code> declares a closed tagged union. Each update case returns <code>(with next-model)</code>, optionally followed by command keywords. Adding a variant without an update case produces a located diagnostic. Wildcard update cases are rejected, so every message stays visible in review.</p>
<p>Message payloads are checked wherever they are built: command success, error recovery, and view events. A string cannot become <code>GotCount.count</code>. Update is pure; naming a command schedules work without running it.</p>
<p><code>with</code> keeps the model and its work together. A keyword such as <code>:load-count</code> identifies a declared command; unknown command names are rejected. Ordinary <code>if</code> and <code>let</code> can choose transitions.</p>
</div>
<div class="fh-window"><div class="fh-window__bar"><span>counter.lisp</span><span>complete checked source</span></div>

<<< @/snippets/elm/counter.lisp

</div>
</div>
<div class="fh-pair">
<div class="fh-window"><div class="fh-window__bar"><span>one update arm removed</span><span>real diagnostic</span></div>

<<< @/snippets/elm/missing-update.txt

</div>
<div class="fh-window"><div class="fh-window__bar"><span>wrong success payload</span><span>real diagnostic</span></div>

<<< @/snippets/elm/invalid-payload.txt

</div>
</div>
</section>

<section id="commands" class="fh-spread fh-tone-red" aria-labelledby="commands-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">02</span>
<div><p class="fh-spread__kicker">Commands</p><h2 id="commands-heading" class="fh-spread__name">Every declared failure becomes a message.</h2></div>
<span class="fh-status is-live">Prototype · TypeScript engine</span>
</header>
<div class="fh-spread__body">
<div class="fh-spread__story">
<p class="fh-spread__title">The Elm guarantee, checked.</p>
<p>Elm's <code>Cmd</code> has no typed failure channel. Here a command wraps an ordinary Forma Effect value with declared success, errors, and service requirements. <code>:ok</code> maps the value to a message. <code>:error</code> names each error and maps its payload to a message. The resulting command has <code>E = never</code>.</p>
<p>The checker requires a mapping for every error in the operation's declared set, even when a particular implementation never raises it. Catch-all handlers cannot erase that obligation. Services stay in <code>R</code>; TypeScript host code provides the resource layer to Foldkit.</p>
<p>This covers <strong>typed failures</strong>. Defects, interruption, and exceptions in hand-written service implementations are still Effect runtime concerns. The prototype does not prove totality or eliminate runtime crashes.</p>
</div>
<div class="fh-window"><div class="fh-window__bar"><span>error mapping removed</span><span>real diagnostic</span></div>

<<< @/snippets/elm/unmapped-error.txt

</div>
</div>
</section>

<section id="views" class="fh-spread fh-tone-teal" aria-labelledby="views-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">03</span>
<div><p class="fh-spread__kicker">View</p><h2 id="views-heading" class="fh-spread__name">Describe the screen. Produce messages.</h2></div>
<span class="fh-status is-live">Prototype · TypeScript engine</span>
</header>
<div class="fh-spread__body">
<div class="fh-spread__story">
<p class="fh-spread__title">No services in render.</p>
<p>The Hiccup tree generates Foldkit <code>HtmlBuilder</code> calls. Text and class expressions are pure functions returning <code>String</code>. Click expressions are pure functions returning <code>Msg</code>. Calling a service or placing an Effect in either position fails the checker; view has no Effect environment.</p>
<p>The deliberately small surface supports <code>:div</code>, <code>:span</code>, <code>:button</code>, <code>:class</code>, and <code>:on-click</code>. A click contains a message value, evaluated from the current model when rendering. Arbitrary JavaScript handlers, raw HTML, and I/O are outside this vocabulary.</p>
</div>
<div class="fh-window"><div class="fh-window__bar"><span>service called in a text node</span><span>real diagnostics</span></div>

<<< @/snippets/elm/impure-view.txt

</div>
</div>
</section>

<section id="end-to-end" class="fh-spread fh-tone-amber" aria-labelledby="end-to-end-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">04</span>
<div><p class="fh-spread__kicker">End to end</p><h2 id="end-to-end-heading" class="fh-spread__name">One API contract, both sides.</h2></div>
<span class="fh-status">Proposed</span>
</header>
<div class="fh-spread__body fh-spread__body--stack">
<div class="fh-spread__story fh-spread__story--wide">
<p class="fh-spread__title">The database-to-DOM headline is the direction.</p>
<p>The <a href="/effect/http-api">HttpApi spike</a> already checks server handler contracts against endpoint declarations. This prototype checks frontend operations and messages separately. It does <strong>not</strong> derive client commands from those endpoints or share their declarations across generators.</p>
<p>The proposed connection would derive client success and error messages from an <code>api</code>. Adding an endpoint error could then add a message variant and make frontend update non-exhaustive. Today you add the message and recovery explicitly; changing an API declaration alone does not change the app.</p>
</div>
</div>
</section>

<section id="output" class="fh-section" aria-labelledby="output-heading">
<div class="fh-section__head">
<p class="fh-label"><span>05</span> The output</p>
<h2 id="output-heading">Plain Foldkit. Plain Effect.</h2>
<p>This is the complete generated module from the counter source above, checked against <code>foldkit@0.168.0</code> and <code>effect@4.0.3</code>. No Forma runtime is imported.</p>
</div>
<div class="fh-facts">
<article><h3>Schema-backed data</h3><p>Model and Msg become Effect schemas and TypeScript types. Message tags and payload fields survive generation.</p></article>
<article><h3>Named commands</h3><p>Prelude emit hooks produce <code>Command.define</code>. An adapter turns checked command keywords into deferred Foldkit commands.</p></article>
<article><h3>A mountable app</h3><p>The exported Counter configuration has Model, init, update, and view. Host code passes it, a container, and service layers to <code>Runtime.makeElement</code>.</p></article>
<article><h3>An isolated generator</h3><p>Call <code>generateElmProgram</code> from <code>@formalang/ts/elm</code>. Prelude descriptors define the domain IR; existing mechanics checks the lowered expressions.</p></article>
</div>
<div class="fh-window"><div class="fh-window__bar"><span>counter.ts</span><span>actual generator output</span></div>

<<< @/snippets/elm/counter.ts

</div>
</section>

<section class="fh-section" aria-labelledby="evidence-heading">
<div class="fh-section__head">
<p class="fh-label"><span>06</span> Evidence</p>
<h2 id="evidence-heading">A running prototype, with rejection cases.</h2>
<p>The <a href="https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript/cases/elm-counter">counter conformance case</a> compares generated TypeScript to a golden, checks it under strict settings without type escapes, validates its declaration artifacts, and runs a headless harness.</p>
</div>
<ol class="fh-checks">
<li><strong>Transitions.</strong> Init creates the expected model. Increment and decrement preserve immutable earlier models. Load returns a command and sets the loading state.</li>
<li><strong>Real execution.</strong> The same command runs against success and failure service layers. Its messages feed update, producing the expected count, status, and error reason.</li>
<li><strong>Located rejection.</strong> Exact fixtures pin missing update cases, unmapped errors, catch-all recovery, invalid success and event payloads, unknown commands, and impure update and view.</li>
</ol>
<p>These fixtures establish the prototype's current behavior. There is no browser DOM harness for the full DSL or generated HttpApi client.</p>
</section>

<section id="what-you-give-up" class="fh-section" aria-labelledby="cost-heading">
<div class="fh-section__head">
<p class="fh-label"><span>07</span> The cost</p>
<h2 id="cost-heading">What you give up.</h2>
<p>This is a small application-language experiment. The costs and boundaries are part of its contract.</p>
</div>
<div class="fh-columns">
<div class="fh-list fh-list--no"><h3>Trade-offs</h3><ul>
<li><strong>Two languages.</strong> App logic is Lisp; service adapters, mounting, and tests are TypeScript. Debugging follows generated code because source maps are absent.</li>
<li><strong>A restricted view.</strong> Three elements and two attributes are enough to test the loop, not to build an accessible production component library. Routing, forms, inputs, lists, and UI components need more design.</li>
<li><strong>Explicit transitions.</strong> Every update result uses <code>with</code>. Every command error gets a named recovery mapping. The ceremony makes obligations reviewable.</li>
</ul></div>
<div class="fh-list fh-list--no"><h3>Missing today</h3><ul>
<li><strong>Command arguments and lifecycle.</strong> Commands wrap zero-argument Effect values. Model-derived arguments, cancellation, subscriptions, and managed resources are not implemented.</li>
<li><strong>Integration.</strong> One app and one message union per source. No module linking, CLI integration, editor routing, or browser worker support for these forms.</li>
<li><strong>Production guarantees.</strong> No SSR, hydration, source maps, totality proof, or compatibility promise. Host service code remains trusted.</li>
</ul></div>
</div>
</section>

<section class="fh-section" aria-labelledby="questions-heading">
<div class="fh-section__head">
<p class="fh-label"><span>08</span> Open questions</p>
<h2 id="questions-heading">The surface should follow the app.</h2>
<p>The syntax is designed around authoring a Lisp application, rather than exposing every Foldkit factory.</p>
</div>
<div class="fh-facts">
<article><h3>Why with?</h3><p>A transition is a model plus work. <code>with</code> makes that one expression and keeps update pure. Named keywords avoid exposing Command construction in user code. Argument-bearing commands need a next design.</p></article>
<article><h3>Why Hiccup?</h3><p>A vector tree is compact and familiar in a Lisp. Existing <code>ui.lisp</code> and ViewSpec describe ontology-bound interfaces; this view renders an application model. They remain separate prototypes, with no shared component or event bridge yet.</p></article>
<article><h3>Subscriptions</h3><p>Model-driven subscriptions should describe lifetime and teardown, rather than act like commands fired by update. Their syntax and typed message relationship are proposed, not implemented.</p></article>
<article><h3>One contract across the network</h3><p>Which endpoint errors become distinct messages? Which remain a shared failure payload? Until the HttpApi bridge answers that, the server and frontend contracts are checked independently.</p></article>
</div>
</section>

<section class="fh-section" aria-labelledby="fit-heading">
<div class="fh-section__head">
<p class="fh-label"><span>09</span> Fit</p>
<h2 id="fit-heading">When to try it.</h2>
</div>
<div class="fh-columns">
<div class="fh-list fh-list--yes"><h3>Worth trying</h3><ul>
<li>Experiments in a typed Lisp for the Elm Architecture.</li>
<li>Small new Foldkit widgets with a few service-backed commands.</li>
<li>Teams studying how to make error recovery and message coverage visible in review.</li>
</ul></div>
<div class="fh-list fh-list--no"><h3>Not yet</h3><ul>
<li>Replacing an existing production Elm or TypeScript frontend.</li>
<li>Apps that need routing, subscriptions, complex inputs, or a component ecosystem.</li>
<li>Teams that need stable editor tooling or shared server/client API generation today.</li>
</ul></div>
</div>
</section>

<section class="fh-closing" aria-labelledby="closing-heading">
<h2 id="closing-heading">Read the loop, then run its commands.</h2>
<p>The reference documents the complete prototype surface. The fixture shows the generated module and the service layers that exercise it.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="/elm/reference">Prototype reference</a>
<a class="fh-button" href="https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript/cases/elm-counter">Counter conformance</a>
<a class="fh-button" href="/effect">Forma for Effect</a>
</div>
</section>

</div>
