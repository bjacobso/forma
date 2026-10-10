---
layout: home
title: Forma for Foldkit
description: Put a typed language inside a Foldkit app. Forma's structural workbench provides the engine as a Foldkit resource, runs analysis as commands, and asks before programs touch the world. What exists, and what you give up.
sidebar: false
aside: false
pageClass: forma-index forma-foldkit
---

<div class="forma-home">

<header class="fh-hero" aria-labelledby="hero-title">
<div class="fh-blueprint" aria-hidden="true"></div>
<div class="fh-hero__copy">
<p class="fh-eyebrow"><span class="fh-dot"></span>Forma in Foldkit · pre-alpha</p>
<h1 id="hero-title">Put a typed language inside a Foldkit app.</h1>
<p class="fh-lead">Some apps need their users to write programs: rules, workflows, pricing, configuration. Forma's engine fits Foldkit's model, update, and view loop. The language host is an Effect service provided as a Foldkit resource. Every request to it is a command that answers with a message, and the model stays plain data. Forma's structural workbench is built this way. <strong>Forma does not generate Foldkit code.</strong> You write the app in TypeScript, and Forma is the language inside it.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="/workbench/demo/" target="_self">Open the workbench <span aria-hidden="true">↗</span></a>
<a class="fh-button" href="#what-you-give-up">Read the trade-offs first</a>
</div>
</div>
<div class="fh-hero__side">
<div class="fh-window fh-window--art">
<div class="fh-window__bar" aria-hidden="true"><span class="fh-window__dots"><i></i><i></i><i></i></span><span>update.ts → FormaHost → update.ts</span></div>

<pre class="fh-ascii" v-pre aria-label="An outline edit reaches update, which schedules an analysis for the new revision after a 120 millisecond pause. The AnalyzeProgram command calls the language host, which the app provides as a Foldkit resource. The answer comes back as an Analyzed message; update drops it if its revision is stale, and otherwise the view shows it."><span class="fh-ascii__code">edit a row</span>
   │  Outliner.Replace
   ▼
<span class="fh-ascii__code">update</span> ──▶ <b>ScheduleAnalysis</b>(revision)
   │        waits 120 ms
   ▼
<b>AnalyzeProgram</b> ──▶ FormaHost
   │        a LanguageHost resource
   ▼
<b>Analyzed</b>({ analysis })
   │  older revision? dropped
   ▼
<span class="fh-ascii__code">update</span> ──▶ <span class="fh-ascii__code">view</span></pre>

</div>
<p class="fh-hero__note">↓ a capture of the real Foldkit app · <a href="/workbench/demo/" target="_self">run it</a></p>
</div>
</header>

<section id="live" class="fh-live" aria-label="The workbench app">
<div class="fh-hero__demo">
<div class="fh-live-embed">
<div class="fh-window">
<div class="fh-window__bar" aria-hidden="true"><span class="fh-window__dots"><i></i><i></i><i></i></span><span>apps/workbench · onboarding.forma</span><span class="fh-window__meta">screenshot</span></div>
<img src="./images/workbench/outline.png" alt="The Forma workbench: outline rows with live values and inferred types, descriptor placeholders, and an inspector showing an expanded collection" width="1440" height="1000" loading="lazy">
</div>
<a class="fh-live-embed__fallback" href="/workbench/demo/" target="_self">Open the live workbench ↗</a>
</div>
</div>
<p class="fh-caption">The standalone app in <a href="https://github.com/bjacobso/forma/tree/main/apps/workbench"><code>apps/workbench</code></a>, running the onboarding program. Each outline row is one Forma form, with its observed value and inferred type, and the inspector expands a retained collection. The live source embeds on the home and <a href="/effect">Effect</a> pages use CodeMirror, not Foldkit. This app uses Foldkit for the whole UI.</p>
</section>

<section class="fh-section" aria-labelledby="problem-heading">
<div class="fh-section__head">
<p class="fh-label"><span>00</span> The problem</p>
<h2 id="problem-heading">A language engine is stateful, slow, and can touch the world.</h2>
<p>A Foldkit app keeps its state in a model that is plain data, changes it only in <code>update</code>, and does work through commands. A language engine works differently. It holds sessions and retained values. Its answers can arrive after the user has typed again. It can also run programs that call the outside world. <strong>The workbench maps each of these onto a Foldkit construct</strong>, so the engine follows the same rules as the rest of the app.</p>
</div>
<ol class="fh-xray" aria-label="Language engine concerns in the workbench, and the Foldkit construct that handles each one">
<li class="fh-xray__root" aria-hidden="true">packages/workbench/src/</li>
<li class="fh-tone-blue"><a href="#resources-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">host.ts</span><code>FormaHost.layer(host, config)</code><span class="fh-xray__kind">← sessions</span><span class="fh-xray__form">resource</span></a></li>
<li class="fh-tone-teal"><a href="#analysis-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">commands.ts</span><code>AnalyzeProgram({ revision, rows, base })</code><span class="fh-xray__kind">← analysis</span><span class="fh-xray__form">command</span></a></li>
<li class="fh-tone-teal"><a href="#analysis-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">update.ts</span><code>analysis.revision !== model.outline.revision</code><span class="fh-xray__kind">← late replies</span><span class="fh-xray__form">message</span></a></li>
<li class="fh-tone-blue"><a href="#resources-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">commands.ts</span><code>host.projectValue({ sessionId, valueRef: id, … })</code><span class="fh-xray__kind">← large values</span><span class="fh-xray__form">command</span></a></li>
<li class="fh-tone-amber"><a href="#capabilities-heading"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">run-commands.ts</span><code>ResumeRun({ run, basis, allow })</code><span class="fh-xray__kind">← side effects</span><span class="fh-xray__form">checkpoint</span></a></li>
<li class="fh-tone-violet"><a href="#output-heading"><span class="fh-xray__branch" aria-hidden="true">└──</span><span class="fh-xray__file">index.ts</span><code>export * as Workspace from "./workspace.js"</code><span class="fh-xray__kind">← projects</span><span class="fh-xray__form">submodel</span></a></li>
</ol>
</section>

<section id="resources" class="fh-spread fh-tone-blue" aria-labelledby="resources-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">01</span>
<div>
<p class="fh-spread__kicker">Resources</p>
<h2 id="resources-heading" class="fh-spread__name">FormaHost</h2>
</div>
<span class="fh-status is-live">Shipped · @formalang/workbench</span>
</header>
<div class="fh-spread__story fh-spread__story--wide">
<p class="fh-spread__title">The engine is a resource, not model state.</p>
<div class="fh-story">
<span class="fh-story__label">The session in the model</span>
<p>A language session is a handle to state inside the engine. Put it in the model, and the model is no longer plain data. Nothing is responsible for closing the session when the app goes away.</p>
</div>
<p class="fh-spread__does"><code>FormaHost</code> is an Effect <code>Context.Service</code>. The app passes its layer as the runtime's <code>resources</code>, which Foldkit builds once and shares with every command. The layer opens a session, loads the preludes, and registers the capabilities. When the runtime's scope ends, its finalizer closes every session the resource opened. Each analysis and run opens a fresh session through the same service. Expanding a value in the inspector projects a handle in that session, and a superseded analysis is released by closing its session.</p>
</div>
<div class="fh-pair fh-pair--spread">
<div>
<p class="fh-file">apps/workbench/src/main.ts</p>

<<< @/snippets/foldkit/main.ts{17}

</div>
<div>
<p class="fh-file">packages/workbench/src/host.ts</p>

<<< @/snippets/foldkit/host.ts{10-14}

</div>
</div>
</section>

<section id="analysis" class="fh-spread fh-tone-teal" aria-labelledby="analysis-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">02</span>
<div>
<p class="fh-spread__kicker">Commands</p>
<h2 id="analysis-heading" class="fh-spread__name">Analyzed({ analysis })</h2>
</div>
<span class="fh-status is-live">Shipped · @formalang/workbench</span>
</header>
<div class="fh-spread__story fh-spread__story--wide">
<p class="fh-spread__title">One analysis per revision. Late answers are dropped.</p>
<div class="fh-story">
<span class="fh-story__label">The stale underline</span>
<p>You fix a type error, and a moment later a red underline appears on the corrected text. The analysis of the old text finished after you typed the new one.</p>
</div>
<p class="fh-spread__does">Every outline change produces a new revision and starts <code>ScheduleAnalysis</code>, which waits 120 ms. When <code>AnalysisDue</code> arrives, <code>update</code> analyzes only if that revision is still current. <code>AnalyzeProgram</code> prints the rows and asks the host for types, the symbol index, and observed values, then elaborates descriptor forms. It answers with <code>Analyzed</code>. A result for an older revision is ignored, and its value session is released. Failures are messages too, so <code>update</code> decides what the user sees.</p>
</div>
<div class="fh-pair fh-pair--spread">
<div>
<p class="fh-file">packages/workbench/src/commands.ts</p>

<<< @/snippets/foldkit/commands.ts

</div>
<div>
<p class="fh-file">packages/workbench/src/update.ts</p>

<<< @/snippets/foldkit/update.ts{3-9}

</div>
</div>
</section>

<section id="capabilities" class="fh-spread fh-tone-amber" aria-labelledby="capabilities-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">03</span>
<div>
<p class="fh-spread__kicker">Capabilities</p>
<h2 id="capabilities-heading" class="fh-spread__name">Chat.post?</h2>
</div>
<span class="fh-status is-live">Shipped · simulated in the demo</span>
</header>
<div class="fh-spread__body">
<div class="fh-spread__story">
<p class="fh-spread__title">Programs ask before they touch the world.</p>
<div class="fh-story">
<span class="fh-story__label">The write while typing</span>
<p>Live analysis evaluates the program every time typing pauses. If the program posts to a chat channel, a naive live editor posts every time you stop typing.</p>
</div>
<p class="fh-spread__does">The app declares each capability with a name, a type scheme, a purity, a description, and an Effect that performs it. Forma suspends evaluation at every call and hands the host a <code>HostCall</code>.</p>
<dl class="fh-effect fh-effect--words">
<div><dt>Analyze</dt><dd>never performs a capability. The call fails with an approval-required error, and values observed before it stay visible.</dd></div>
<div><dt>Run</dt><dd>turns each call into a Foldworks permission checkpoint. Allow performs it once. Deny resumes with a located failure. Reads and writes both ask, every time.</dd></div>
<div><dt>Edit</dt><dd>aborts a paused run, and its later replies are rejected.</dd></div>
</dl>
</div>
<div class="fh-window">
<div class="fh-window__bar"><span>apps/workbench</span><span>screenshot · Run</span></div>
<img src="./images/workbench/permission.png" alt="Permission checkpoint for Directory.lookup with the ada argument, the capability's description, and Allow once and Deny controls" width="1440" height="1000" loading="lazy">
</div>
</div>
<div class="fh-pair fh-pair--spread">
<div>
<p class="fh-file">apps/workbench/src/program/capabilities.ts</p>

<<< @/snippets/foldkit/capabilities.ts{4,14-18}

</div>
<div>
<p class="fh-file">packages/workbench/src/run-commands.ts</p>

<<< @/snippets/foldkit/run-commands.ts

</div>
</div>
</section>

<section class="fh-section" aria-labelledby="output-heading">
<div class="fh-section__head">
<p class="fh-label"><span>04</span> What ships</p>
<h2 id="output-heading">A submodel and a service, not a framework.</h2>
<p><code>@formalang/workbench</code> exports two Foldkit submodels and the pieces under them. It has no domain of its own. The program, its preludes, its checks, and its capabilities all come from configuration. The demo app in <code>apps/workbench</code> supplies three example projects, a workflow prelude, and simulated directory and chat capabilities.</p>
</div>
<div class="fh-facts">
<article><h3>Workbench and Workspace</h3><p><code>Workbench</code> edits one document as an outline and as source. <code>Workspace</code> adds projects, file modules, go-to-definition, and a REPL. Each exports <code>Model</code>, <code>init</code>, <code>update</code>, and <code>view</code>, and its messages are Effect Schemas declared with <code>defineMessageUnion</code>.</p></article>
<article><h3>Foldworks components</h3><p>The outline is <code>@foldworks/outliner</code>, the source pane is <code>@foldworks/code-editor</code>, values open in <code>ValueTree</code>, proposals are reviewed in <code>TreeDiff</code>, and approvals use <code>@foldworks/agent</code>.</p></article>
<article><h3>Domain forms from preludes</h3><p>The onboarding prelude registers <code>step</code> and <code>workflow</code> with typed <code>form</code> declarations. The outline offers their missing clauses as placeholders, and the app adds a dataflow check over the elaborated declarations.</p></article>
<article><h3>Host first</h3><p>Everything except elaboration and reading a single row's syntax goes through <code>LanguageHost</code>, so another host could answer the same commands. The in-process TypeScript host is the only one built so far.</p></article>
</div>
</section>

<section class="fh-section" aria-labelledby="map-heading">
<div class="fh-section__head">
<p class="fh-label"><span>05</span> The map</p>
<h2 id="map-heading">Where each piece lives.</h2>
<p>If you embed Forma in your own Foldkit app, these are the files to read first. Paths are under <code>packages/workbench/src/</code> unless they say otherwise.</p>
</div>
<div class="fh-table">

| Concern | File | Foldkit construct |
| --- | --- | --- |
| Mounting the app | `apps/workbench/src/main.ts` | `Runtime.makeElement` with `resources` |
| The engine and its sessions | `host.ts` | an Effect `Context.Service` and `Layer` |
| What an app configures | `config.ts` | `WorkbenchConfig` and `Capability` |
| Reading, analysis, and values | `commands.ts` | `Command.define` |
| Runs and approvals | `run-commands.ts`, `run.ts` | `Command.define` and `@foldworks/agent` |
| Previews and proposals | `edit-commands.ts`, `propose-command.ts` | `Command.define` |
| State and messages | `model.ts`, `message.ts` | a Schema model and `defineMessageUnion` |
| Projects and the REPL | `workspace.ts` | a submodel around `Workbench` |
| Analysis as editor facts | `adapter.ts` | `@foldworks/text-intelligence` |

</div>
</section>

<section class="fh-section" aria-labelledby="proof-heading">
<div class="fh-section__head">
<p class="fh-label"><span>06</span> Evidence</p>
<h2 id="proof-heading">What the tests pin.</h2>
<p>The workbench's Vitest suite runs in <code>pnpm check</code>, against the pinned Foldworks build that <code>node scripts/setup-workspace.mjs</code> links. CI also runs the demo's Playwright suite in a browser. The claims above rest on these tests in <a href="https://github.com/bjacobso/forma/tree/main/packages/workbench/test"><code>packages/workbench/test</code></a> and <a href="https://github.com/bjacobso/forma/tree/main/apps/workbench/e2e"><code>apps/workbench/e2e</code></a>:</p>
</div>
<ol class="fh-steps">
<li><strong>Approval.</strong> gates every host call, propagates requirements, and cancels a stale permission on edits</li>
<li><strong>Analysis is safe.</strong> observes calls inside functions and macro arguments without running capabilities</li>
<li><strong>Handles are owned.</strong> projects retained values in their own session, then releases them</li>
<li><strong>The REPL is safe.</strong> REPL replay never performs a host capability</li>
<li><strong>Identity survives.</strong> reconciles source edits without changing untouched node ids or layout</li>
<li><strong>Edits are structural.</strong> renames a definition and its uses, preserves shadowing, and undoes atomically with exact source</li>
<li><strong>In the browser.</strong> requires approval for read and write calls and shows the completed values</li>
<li><strong>Every edit is analyzed.</strong> analyzes each edit and underlines the new type error</li>
</ol>
<p>A website test checks that each code excerpt on this page is still a verbatim copy of the file it names, and that each test listed above still exists. Nothing on this page is tested against a Foldkit generator, because there isn't one.</p>
</section>

<section id="what-you-give-up" class="fh-section" aria-labelledby="cost-heading">
<div class="fh-section__head">
<p class="fh-label"><span>07</span> The cost</p>
<h2 id="cost-heading">What you give up.</h2>
<p>Embedding a language engine in a Foldkit app is real work, and the package that does it is not published yet. These are the costs today. Some come with the approach, and some are work that hasn't been done.</p>
</div>
<div class="fh-columns">
<div class="fh-list fh-list--no">
<h3>Fundamental trade-offs</h3>
<ul>
<li><strong>No Foldkit code from Forma.</strong> Forma does not generate models, messages, update functions, or views, and nothing checks Foldkit code written in Forma. You write the app in TypeScript. Forma is the language your users write inside it.</li>
<li><strong>A compiler in your page.</strong> The demo runs <code>TsLanguageHost</code> in-process, on the main thread. The <a href="/workbench">design note</a> measured 50–90 ms to analyze a 60-line program in Node, so analysis waits for a pause in typing instead of running on every keystroke.</li>
<li><strong>Asynchrony you handle.</strong> Every host request is a command whose answer can arrive late. The workbench tags analyses, runs, and proposals with a revision or token and drops stale replies. Any app that embeds Forma needs the same discipline.</li>
<li><strong>Approval is the app's job.</strong> Forma suspends at host calls. The app decides what is allowed and builds the interface for it. The workbench uses <code>@foldworks/agent</code>.</li>
</ul>
</div>
<div class="fh-list fh-list--no">
<h3>Missing today</h3>
<ul>
<li><strong>Packages.</strong> <code>@formalang/workbench</code> is private. The Foldworks packages it renders are not on npm yet, so building it requires the local link that <code>node scripts/setup-workspace.mjs</code> sets up. See the <a href="https://github.com/bjacobso/forma/tree/main/packages/workbench">package README</a>.</li>
<li><strong>Other hosts.</strong> There is no worker-backed or OCaml host for the workbench. Elaboration and per-row syntax call <code>@formalang/ts</code> directly, because the host ABI doesn't expose them yet.</li>
<li><strong>Call locations.</strong> <code>HostCall</code> carries no span. The workbench places a call at its capability's reference only when there is exactly one, and on the whole program otherwise.</li>
<li><strong>Traces and recovery.</strong> Observation keeps each expression's last value and count, so there is no step-through. Evaluation stops at the first failure, and later rows show no values until it is fixed.</li>
<li><strong>Effect programs.</strong> Programs with Effect signatures get <code>Effect&lt;A, E, R&gt;</code> types, but the workbench doesn't run them.</li>
<li><strong>Persistence and scale.</strong> Drafts live in memory and are lost on reload. The outline isn't virtualized.</li>
<li><strong>Themes.</strong> The palette controls of the source embeds are not mapped to Foldworks themes.</li>
</ul>
</div>
</div>
</section>

<section class="fh-section" aria-labelledby="unknown-heading">
<div class="fh-section__head">
<p class="fh-label"><span>08</span> Open questions</p>
<h2 id="unknown-heading">What hasn't been thought through yet.</h2>
<p>None of these has a design. They are listed so that nobody mistakes them for plans.</p>
</div>
<div class="fh-facts">
<article><h3>Writing Foldkit in Forma</h3><p>Foldkit models and messages are declared as Effect Schemas, as the workbench's are, and the <a href="/effect">Effect generator</a> already emits Schema declarations. Nobody has explored whether Forma could author Foldkit models, messages, and update functions, or check them the way it checks Effect operations. There is no RFC or spike.</p></article>
<article><h3>A worker host</h3><p>Commands already treat the host as asynchronous, so a host in a worker could in principle answer the same messages without blocking input. It hasn't been built or measured.</p></article>
<article><h3>Running Effect programs</h3><p>Running typed Effect programs through gated service layers is listed as follow-up work. How per-call approval maps onto service layers is open.</p></article>
<article><h3>Live sessions</h3><p><a href="/rfcs/0010-live-sessions">RFC 0010</a> proposes sessions whose definitions persist and can be redefined, with Foldworks as one possible UI. Today the workbench opens a fresh session for each analysis and run.</p></article>
<article><h3>Analysis in the model</h3><p>The latest analysis is stored in the model as Schema data. How that behaves for large programs hasn't been measured.</p></article>
<article><h3>A public API</h3><p>Publishing waits on Foldworks releases. The workbench's exports may change before then, and no other app embeds them yet.</p></article>
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
<li>A Foldkit app whose users write small programs, such as rules, workflows, pricing, or configuration, with domain forms from a prelude.</li>
<li>Apps where programs written by people or tools must ask before they read or write anything.</li>
<li>Structural editors and teaching tools that want a value, a type, and errors on every form.</li>
<li>Research on language workbenches built from Foldkit and Foldworks.</li>
</ul>
</div>
<div class="fh-list fh-list--no">
<h3>Not yet</h3>
<ul>
<li>Writing the Foldkit app itself in Forma.</li>
<li>Apps that need installable npm packages today.</li>
<li>Large programs, or analysis that must stay off the main thread.</li>
<li>Running Effect programs from the editor.</li>
</ul>
</div>
</div>
</section>

<section class="fh-closing" aria-labelledby="closing-heading">
<h2 id="closing-heading">Open the app, then read how it's built.</h2>
<p>The demo opens an onboarding workflow, a REPL project, and a four-file module project. The design note explains each decision and its limits.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="/workbench/demo/" target="_self">Open the workbench</a>
<a class="fh-button" href="/workbench">Design note</a>
<a class="fh-button" href="https://github.com/bjacobso/forma/tree/main/packages/workbench">Source</a>
</div>
</section>

</div>
