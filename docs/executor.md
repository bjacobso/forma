---
layout: home
title: Forma for code mode
description: Agents call tools by writing programs. If the tool catalog is a set of typed services, a program's signature lists every tool it can reach, and Forma checks the body against it before the first call. A worked example in the style of Executor's code mode, with real diagnostics, generated Effect TypeScript, and a harness that runs it.
sidebar: false
aside: false
pageClass: forma-index forma-executor
---

<div class="forma-home">

<header class="fh-hero" aria-labelledby="hero-title">
<div class="fh-blueprint" aria-hidden="true"></div>
<div class="fh-hero__copy">
<p class="fh-eyebrow"><span class="fh-dot"></span>Forma for code mode · pre-alpha example</p>
<h1 id="hero-title">Code mode, checked before the first tool call.</h1>
<p class="fh-lead">Agents do better when they write a program than when they call forty tools one turn at a time. <a href="https://executor.sh">Executor</a>'s code mode gives them one <code>execute</code> tool, a sandboxed program, and a catalog of typed tools. This page asks what the program's language could add. When each tool is a typed service member, a program's signature lists every tool it can reach. The checker shows that the body calls nothing outside that list. The host can then approve one short manifest before anything runs.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="#live">Edit an agent's turn live <span aria-hidden="true">↓</span></a>
<a class="fh-button" href="#what-you-give-up">Read the limits first</a>
</div>
</div>
<div class="fh-hero__side">
<div class="fh-window fh-window--art">
<div class="fh-window__bar" aria-hidden="true"><span class="fh-window__dots"><i></i><i></i><i></i></span><span>turn.lisp → check → manifest → run</span></div>
<pre class="fh-ascii" v-pre aria-label="The agent submits a turn. The checker either returns located diagnostics, with nothing run, or returns the tools the program requires. The host joins that manifest with its policy and asks once. The approved program runs, and each tool call goes to Executor."><span class="fh-ascii__code">        agent
          │ turn.lisp
          ▼
   <b>check</b> against catalog ─ reject ─→ diagnostics
          │                          nothing ran
          ▼
   requires [GitHub.list-issues
             Slack.post-message]
          │
          ▼
   host policy ── ask once ──→ user
          │
          ▼
   <b>run</b> ── call(path, input) ──→ Executor
          │
          ▼
        result</span></pre>
</div>
<p class="fh-hero__note">Existing Effect dialect · no Executor integration · <a href="https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript/cases/executor-digest">conformance case</a></p>
</div>
</header>

<section id="live" class="fh-live" aria-label="Live turn checker">
<div class="fh-hero__demo">

<WorkbenchEmbed example="executor-turn" file="turn.forma" title="Live Effect workbench: a code-mode turn and its tool manifest" />

</div>
<p class="fh-caption">The embed runs the real checker in your browser over the tool catalog and one agent turn. <strong>Introduce error</strong> makes the program close every stale issue without declaring <code>GitHub.close-issue</code>. Restore the program, or add the tool to the signature of <code>main</code>. The embed checks and generates code. It calls no tools.</p>
</section>

<section class="fh-section" aria-labelledby="principles-heading">
<div class="fh-section__head">
<p class="fh-label"><span>00</span> First principles</p>
<h2 id="principles-heading">What code mode asks of a language.</h2>
<p>Begin with what goes wrong when a model uses tools, then work out what the program's language must provide.</p>
</div>
<div class="fh-facts">
<article><h3>1. Tool calls are a slow loop</h3><p>Each direct tool call is a model round trip, and every intermediate result passes through the context window. A program can call tools, filter results, and return only what matters. That is why agents are moving from tool calls to code.</p></article>
<article><h3>2. The tool call is the only exit</h3><p>Executor's <a href="https://executor.sh/docs/mcp">MCP documentation</a> describes an interpreter with no <code>fetch</code>, <code>process</code>, filesystem, timers, or imports: "Its only way out is a tool call." So the question that matters is which calls a program can make, and with which inputs.</p></article>
<article><h3>3. First drafts are slightly wrong</h3><p>A value that isn't in the tool's enum, an unhandled rate limit, a misspelled tool. In a dynamic language each mistake appears when its line runs, possibly after earlier calls have done their work. The rejection should come back as data the model can repair from: a stable code, a line and column in its own source, and the expected value.</p></article>
<article><h3>4. Approval in the middle of a run is costly</h3><p>A refusal "does not undo tool calls that already ran," as Executor's <a href="https://executor.sh/docs/concepts/tools-and-approvals">approval docs</a> note, and a paused program holds live state. Executor lists resuming a program after a server restart as future work, and warns that a lost program "must not be run again automatically, because earlier tool calls may already have taken effect." If the reachable tools are known before the run, approval can come first, before any work starts.</p></article>
</div>
<p class="fh-principles__close">These are properties of a language, not of a sandbox. Forma's version uses vocabulary it already has. <strong>Tools are typed service members, a turn is a module, and an operation's signature is its manifest.</strong></p>
<ol class="fh-xray" aria-label="Executor code-mode concepts and the Forma form for each">
<li class="fh-xray__root" aria-hidden="true">code mode/</li>
<li class="fh-tone-blue"><a href="#catalog"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">search + describe</span><code>tool paths and input types</code><span class="fh-xray__kind">← catalog</span><span class="fh-xray__form">service</span></a></li>
<li class="fh-tone-amber"><a href="#turn"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">execute(program)</span><code>tools.github.listIssues(…)</code><span class="fh-xray__kind">← the turn</span><span class="fh-xray__form">do!</span></a></li>
<li class="fh-tone-red"><a href="#loop"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">approval policy</span><code>allow · ask · block, per tool</code><span class="fh-xray__kind">← manifest</span><span class="fh-xray__form">: main</span></a></li>
<li class="fh-tone-teal"><a href="#run"><span class="fh-xray__branch" aria-hidden="true">├──</span><span class="fh-xray__file">call(path, input)</span><code>credentials stay in the host</code><span class="fh-xray__kind">← routing</span><span class="fh-xray__form">layer</span></a></li>
<li class="fh-tone-blue"><a href="#end-to-end"><span class="fh-xray__branch" aria-hidden="true">└──</span><span class="fh-xray__file">resume</span><code>continue a paused program</code><span class="fh-xray__kind">← proposed</span><span class="fh-xray__form">journal</span></a></li>
</ol>
</section>

<section id="catalog" class="fh-spread fh-tone-blue" aria-labelledby="catalog-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">01</span>
<div><p class="fh-spread__kicker">The catalog</p><h2 id="catalog-heading" class="fh-spread__name"><span>(</span>service GitHub…<span>)</span></h2></div>
<span class="fh-status is-live">Existing Effect dialect</span>
</header>
<div class="fh-spread__body">
<div class="fh-spread__story">
<p class="fh-spread__title">A tool is a typed service member.</p>
<p>Executor's <code>describe</code> returns each tool's input and output types. A Forma host would render that catalog as declarations. Each integration becomes a <code>service</code> and each tool becomes a member. Shared output shapes become schemas, and declared failures become tagged <code>error</code> types.</p>
<p>The catalog is a turn's only route to external systems. The Effect dialect has no <code>fetch</code> and no JavaScript interop. Apart from a few built-in operations, an effect has to be a service member, so it has to be in the catalog. Those built-ins are <code>log</code>, <code>sleep</code>, refs, and <code>config</code>. Because <code>config</code> reads the host's Effect <code>ConfigProvider</code>, a code-mode host should reject it or provide an empty one.</p>
<p>This catalog is <strong>hand-written</strong>. Generating it from Executor's tool types or from JSON Schema is not implemented.</p>
</div>
<div class="fh-window"><div class="fh-window__bar"><span>catalog.lisp</span><span>in scope for every turn</span></div>

<<< @/snippets/executor/catalog.lisp

</div>
</div>
</section>

<section id="turn" class="fh-spread fh-tone-amber" aria-labelledby="turn-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">02</span>
<div><p class="fh-spread__kicker">The turn</p><h2 id="turn-heading" class="fh-spread__name">The signature is the manifest.</h2></div>
<span class="fh-status is-live">Checked · TypeScript engine</span>
</header>
<div class="fh-spread__body">
<div class="fh-spread__story">
<p class="fh-spread__title">Post a digest of stale issues.</p>
<p>The agent writes pure helpers and Effect operations. An operation's signature names its success value, the failures it can still raise, and each tool member it can call: <code>(Effect String [] [GitHub.list-issues Slack.post-message])</code>.</p>
<p>The checker requires the body to agree with that signature. Tool inputs must match the catalog's types, and every declared tool failure must be handled or declared. Every call must be covered by the signature. Pure helpers such as <code>stale?</code> cannot call tools at all.</p>
<p>The empty error set on <code>main</code> is a promise as well. <code>GitHub.list-issues</code> can fail with <code>RateLimited</code>, so <code>open-issues</code> must recover before <code>main</code> can claim it never fails.</p>
</div>
<div class="fh-window"><div class="fh-window__bar"><span>turn.lisp</span><span>what the agent submits</span></div>

<<< @/snippets/executor/turn.lisp

</div>
</div>
</section>

<section id="loop" class="fh-spread fh-tone-red" aria-labelledby="loop-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">03</span>
<div><p class="fh-spread__kicker">The loop</p><h2 id="loop-heading" class="fh-spread__name">Check, repair, approve once.</h2></div>
<span class="fh-status is-live">Real checker output</span>
</header>
<div class="fh-spread__body">
<div class="fh-spread__story">
<p class="fh-spread__title">A rejected turn costs one more turn.</p>
<p>The first draft asks for issues in state <code>:stale</code> and ignores the rate limit. Both mistakes come back together, with codes and line and column positions in the turn. Nothing ran, so there is nothing to undo, and the agent can simply resubmit.</p>
<p>The repaired turn is accepted. The host reads the requirement row of <code>main</code> from the checked declaration and joins it with its own policy: the query runs, and the mutation asks. The user answers one question before the first tool call, not one per call in the middle of a run.</p>
<p>A snippet script produced this transcript. It prepends <code>catalog.lisp</code>, calls <code>elaborateEffectProgram</code>, and reports positions relative to the turn. The policy column is host data in that script. Each turn here is a complete module. Keeping <code>stale?</code> defined for a later turn requires the live sessions in <a href="/rfcs/0010-live-sessions">RFC 0010</a>.</p>
</div>
<div class="fh-window"><div class="fh-window__bar"><span>two turns</span><span>real diagnostics and manifest</span></div>

<<< @/snippets/executor/repl.txt

</div>
</div>
</section>

<section id="manifest" class="fh-spread fh-tone-teal" aria-labelledby="manifest-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">04</span>
<div><p class="fh-spread__kicker">Enforcement</p><h2 id="manifest-heading" class="fh-spread__name">Stricter than the TypeScript it generates.</h2></div>
<span class="fh-status is-live">Conformance case</span>
</header>
<div class="fh-spread__body fh-spread__body--stack">
<div class="fh-spread__story fh-spread__story--wide">
<p class="fh-spread__title">Reading issues and closing them are different risks.</p>
<p>Suppose the agent adds a loop that closes every stale issue: <code>(for-each stale (fn [i] (GitHub.close-issue …)))</code>. In TypeScript, Effect's requirement channel tracks whole services. <code>main</code> already requires <code>GitHub</code>, so <code>tsc</code> accepts the generated code. Forma tracks members. <code>GitHub.close-issue</code> is not in the signature, so the turn is rejected at the call.</p>
<p>That is the granularity an approval policy needs. The manifest is an upper bound: it lists the tools the program <em>may</em> call, and a branch that doesn't run makes no call. Policies that depend on arguments, such as Executor's per-call approval functions, still run in the host when the call happens.</p>
</div>
<div class="fh-pair">
<div class="fh-window"><div class="fh-window__bar"><span>Forma</span><span>rejected before running</span></div>

<<< @/snippets/executor/close-issue.forma.txt

</div>
<div class="fh-window"><div class="fh-window__bar"><span>checker bypassed</span><span>what tsc says</span></div>

<<< @/snippets/executor/close-issue.tsc.txt

</div>
</div>
</div>
</section>

<section id="run" class="fh-section" aria-labelledby="run-heading">
<div class="fh-section__head">
<p class="fh-label"><span>05</span> The run</p>
<h2 id="run-heading">Plain Effect, routed to tool calls.</h2>
<p>An accepted turn generates an ordinary Effect 4 module. The host supplies one layer per service, and each member maps to one tool path. The conformance harness stands in for Executor with a fake <code>call(path, input)</code> endpoint and asserts the exact journal below.</p>
</div>
<div class="fh-facts">
<article><h3>One member, one tool path</h3><p><code>GitHub.listIssues</code> calls <code>github.listIssues</code>. The program never holds a credential or a URL. It holds only a service that the host provided.</p></article>
<article><h3>Outputs are decoded</h3><p>Tool results are untrusted JSON. The layer decodes them with the generated <code>Issue</code> schema. A malformed result becomes a defect at the boundary rather than a wrongly typed value.</p></article>
<article><h3>Failures are values</h3><p>A rate limit from the tool becomes the tagged <code>RateLimited</code> error. The program recovers from it, as its signature promised, and posts nothing.</p></article>
<article><h3>No Forma runtime</h3><p>The generated module imports only <code>effect</code>. It is the same file that the conformance suite compares with its golden, typechecks under strict settings, and runs.</p></article>
</div>
<div class="fh-window"><div class="fh-window__bar"><span>harness.ts journal</span><span>asserted</span></div>

```text
run 1 · three open issues, two stale
  call  github.listIssues  {"repo":"acme/api","state":"open"}
  call  slack.postMessage  {"channel":"#eng",
                            "text":"#12 Flaky deploy\n#31 Retry webhooks"}
  ok    "2 stale issues posted at 1729.42"

run 2 · the tool reports RateLimited
  call  github.listIssues  {"repo":"acme/api","state":"open"}
  ok    "Nothing stale."

run 3 · the tool returns a malformed issue
  call  github.listIssues  {"repo":"acme/api","state":"open"}
  defect  schema decode failed at the layer
```

</div>
<div class="fh-window"><div class="fh-window__bar"><span>program.ts</span><span>actual generator output</span></div>

<<< @/snippets/executor/program.ts

</div>
</section>

<section id="end-to-end" class="fh-spread fh-tone-amber" aria-labelledby="end-to-end-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">06</span>
<div><p class="fh-spread__kicker">End to end</p><h2 id="end-to-end-heading" class="fh-spread__name">One execute tool that speaks Forma.</h2></div>
<span class="fh-status">Proposed</span>
</header>
<div class="fh-spread__body fh-spread__body--stack">
<div class="fh-spread__story fh-spread__story--wide">
<p class="fh-spread__title">Everything above exists. The bridge does not.</p>
<p>A complete integration would put a Forma <code>execute</code> tool next to Executor's JavaScript one. The checker, the generated module, and the layers that route members to tool paths exist. None of the steps below is implemented.</p>
</div>
<ol class="fh-steps">
<li><strong>Render the catalog.</strong> Translate Executor's tool types into <code>service</code>, <code>type</code>, and <code>error</code> declarations, and return them from <code>describe</code>.</li>
<li><strong>Check, then run.</strong> Reject a turn before any call, and grant exactly its manifest. <a href="/rfcs/0012-checked-evaluation">RFC 0012</a> proposes this operation for kernel programs: grants, limits, and a pause with a source span at each capability call.</li>
<li><strong>Run in an isolate.</strong> Route each member through Executor's <code>call</code>. Credentials and per-call policy stay in Executor.</li>
<li><strong>Keep definitions between turns.</strong> <a href="/rfcs/0010-live-sessions">RFC 0010</a> proposes revisioned sessions, so that later turns can reuse helpers.</li>
<li><strong>Record outcomes.</strong> <a href="/rfcs/0016-host-call-journals">RFC 0016</a> proposes journals that replay recorded host calls instead of repeating their effects. It covers kernel host calls and leaves Effect service providers to a later proposal. This is the gap Executor names: a program lost to a restart must not simply run again.</li>
</ol>
</div>
</section>

<section class="fh-section" aria-labelledby="evidence-heading">
<div class="fh-section__head">
<p class="fh-label"><span>07</span> Evidence</p>
<h2 id="evidence-heading">A runnable example, with rejection cases.</h2>
<p>The <a href="https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript/cases/executor-digest">executor-digest case</a> uses the same program as this page. The docs test fails if the page's source, generated module, or journal drifts from the case.</p>
</div>
<ol class="fh-checks">
<li><strong>Generation.</strong> The program has no diagnostics. Its output matches the golden, typechecks without type escapes, and packages as a validated artifact.</li>
<li><strong>Execution.</strong> The harness checks the success path and its exact tool journal, typed rate-limit recovery with no post, and a malformed tool result that fails at the decoding boundary.</li>
<li><strong>Rejection.</strong> <a href="https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript/cases/executor-undeclared-tool">executor-undeclared-tool</a> pins the located undeclared-member diagnostic and records that TypeScript accepts the same code.</li>
</ol>
<p>These are checks of one example program. No model has been evaluated on writing Forma turns, and no Executor client exists in this repository.</p>
</section>

<section id="what-you-give-up" class="fh-section" aria-labelledby="cost-heading">
<div class="fh-section__head">
<p class="fh-label"><span>08</span> The cost</p>
<h2 id="cost-heading">What you give up.</h2>
<p>This is a design sketch built from existing parts. Its costs and boundaries are part of the pitch.</p>
</div>
<div class="fh-columns">
<div class="fh-list fh-list--no"><h3>Trade-offs</h3><ul>
<li><strong>An unfamiliar language.</strong> Models have read far more JavaScript than Forma. Their first drafts will fail more often, and every repair costs a turn. Whether located diagnostics recover that cost is untested.</li>
<li><strong>Signatures are mandatory.</strong> Every top-level operation states its success, errors, and tools. That ceremony is the manifest, so it can't be optional.</li>
<li><strong>A small vocabulary.</strong> The <a href="/effect/reference">Effect subset</a> has no generic operations, no recursive schemas, and no JavaScript interop except through services.</li>
</ul></div>
<div class="fh-list fh-list--no"><h3>Missing today</h3><ul>
<li><strong>Isolation.</strong> Generated TypeScript runs with the authority of the host that imports it. The checker limits which services a turn can name, but the TypeScript engine is not a security boundary. Run untrusted turns in an isolate.</li>
<li><strong>The bridge.</strong> Catalog rendering, an <code>execute</code> tool, checked runs, persistent sessions, and journals for Effect programs are proposals.</li>
<li><strong>Argument policy.</strong> Manifests name tools, not inputs. A channel allowlist or a refund limit is still enforced by the host at call time.</li>
</ul></div>
</div>
</section>

<section class="fh-section" aria-labelledby="questions-heading">
<div class="fh-section__head">
<p class="fh-label"><span>09</span> Open questions</p>
<h2 id="questions-heading">Where the design is still soft.</h2>
</div>
<div class="fh-facts">
<article><h3>Which tool types translate?</h3><p>JSON Schema allows nullable unions, open objects, and recursion. Forma records are closed by default, and recursive schemas are not generated yet. A catalog renderer needs a rule for each of these cases.</p></article>
<article><h3>Should the catalog carry tool kinds?</h3><p>Executor knows which tools are queries and which are mutations. If the catalog recorded that, a host could reject a turn whose manifest contains any mutation, with no policy lookup.</p></article>
<article><h3>What does the model see?</h3><p>A typed result can be printed, summarized, or truncated to an output budget. The right projection for the next prompt is untested.</p></article>
<article><h3>JavaScript, checked?</h3><p>A TypeScript checker over Executor's own signatures would catch some of the same mistakes. It would not see member-level requirements, as section 04 shows.</p></article>
</div>
</section>

<section class="fh-section" aria-labelledby="fit-heading">
<div class="fh-section__head">
<p class="fh-label"><span>10</span> Fit</p>
<h2 id="fit-heading">When to try it.</h2>
</div>
<div class="fh-columns">
<div class="fh-list fh-list--yes"><h3>Worth trying</h3><ul>
<li>Studying static tool manifests and approval before a run.</li>
<li>Prototyping a typed catalog for a few integrations with an Effect host.</li>
<li>Measuring how models repair code from located diagnostics.</li>
</ul></div>
<div class="fh-list fh-list--no"><h3>Not yet</h3><ul>
<li>Running untrusted model output against real accounts.</li>
<li>Replacing Executor's JavaScript <code>execute</code> tool.</li>
<li>Catalogs that need generated, recursive, or open-ended tool types.</li>
</ul></div>
</div>
</section>

<section class="fh-closing" aria-labelledby="closing-heading">
<h2 id="closing-heading">Read the turn, then break its manifest.</h2>
<p>The conformance case contains the catalog, the turn, the generated module, and the harness that plays the part of Executor. Executor is an independent project. This page uses its documented code-mode model as a reference point and does not integrate with it.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript/cases/executor-digest">executor-digest case</a>
<a class="fh-button" href="/rfcs/0012-checked-evaluation">RFC 0012: checked evaluation</a>
<a class="fh-button" href="/effect">Forma for Effect</a>
</div>
</section>

</div>
