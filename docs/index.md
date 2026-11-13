---
layout: home
title: Forma
titleTemplate: false
description: Forma is a programmable typechecker for Lisp, built for defining and checking domain languages. Define vocabulary and checks in preludes, infer types and effects, and turn checked programs into domain data.
sidebar: false
aside: false
pageClass: forma-index
---

<div class="forma-home">

<header class="fh-hero fh-hero--compact" aria-labelledby="hero-title">
<div class="fh-hero__copy">
<p class="fh-eyebrow">Forma <span>· programmable types for Lisp · pre-alpha</span></p>
<h1 id="hero-title">Define your domain.<br>Check its programs.</h1>
<p class="fh-lead">A programmable typechecker for Lisp, built for defining and checking domain languages.</p>
<p class="fh-caption">Preludes define vocabulary and checks. Explore type inference, polymorphism and effects, or turn checked domain programs into data for your application to interpret. <a href="#live">Try the live playground below ↓</a></p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="/playground/custom">Build a domain language</a>
<a class="fh-button" href="/playground/live/inference">Explore the Lisp typechecker</a>
</div>
</div>

<HomepageStories />

</header>

<section id="live" class="fh-live" aria-label="Live playground">
<div class="fh-hero__demo">

<WorkbenchEmbed homepage />

</div>
<p class="fh-caption">Unlike the scripted stories above, this runs the real compiler in your browser. Try <strong>Introduce error</strong>, then repair the source or press <strong>Reset</strong>. Switch examples to explore domain data or Effect TypeScript generation; switching starts a fresh demo. Sharing and advanced tools live in the full playground.</p>
</section>

<section class="fh-statement" aria-labelledby="problem-heading">
<p class="fh-statement__big">A macro adds a keyword in an afternoon. It doesn't add a typing rule.</p>
<p>Lisp makes new syntax cheap and checking expensive. A bad call to a macro fails inside its expansion, at runtime, or in generated code nobody reads. Typed Lisps check programs against rules their authors chose. A domain with rules of its own (every workflow step gets the input it needs, a query sees only its entity's fields, a rule never touches a forbidden capability) still needs its own parser, checker, and tooling.</p>
<p>That is the old Lisp curse: every team ends up with a language only its authors understand. Coding agents make new code cheap in every language, so the curse is spreading. Forma doesn't try to stop teams from building their own languages. It makes those languages agree on what a well-typed program is, so a private language still has a contract someone else can check.</p>
<h2 id="problem-heading" class="fh-statement__question">What if the typing rules were a library too?</h2>
</section>

<section id="how-it-works" class="fh-row" aria-labelledby="library-heading">
<div class="fh-row__head">
<p class="fh-row__num">01</p>
<h2 id="library-heading">Typing rules are library code.</h2>
<span class="fh-status is-stored">Stored output in the browser</span>
</div>
<div class="fh-row__body">
<p><code>entity</code> is not built into the compiler. A prelude describes it with <code>form</code>: the type of each slot, the name it declares, the names its predicates can see, and the typed output it builds.</p>
<div class="fh-window">
<div class="fh-window__bar"><span>preludes/ontology.lisp</span><span>the definition</span></div>

<<< @/snippets/home/define-entity.lisp{6,18,24,31}

<div class="fh-window__bar fh-window__bar--run"><span>schema.lisp</span><span>the use</span></div>

<<< @/snippets/home/entities.lisp

</div>
<p>The form resolves <code>Employee</code>, checks <code>:where</code> as a <code>Bool</code> with the entity's fields in scope, and projects the selected fields into typed IR. The projection is checked against the form's declared IR type, so a prelude can't emit a payload its contract doesn't describe. <a href="/playground/demo/entities" target="_self">Open this example →</a></p>
<p>Each declaration in the artifact also records a content identity for its payload contract: a hash of the IR type and every type it reaches. Two forms with different syntax that build the same IR share an identity, and a consumer can reject a payload built against another definition.</p>
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
<p>In the <a href="#live">live playground above</a>, choose <strong>Explore typed Lisp &amp; effects</strong>, then press <strong>Introduce error</strong>: the body still calls <code>Console.print</code>, but the signature declares no requirements. The Effect checker rejects the operation and points at the call you wrote. Click the problem to jump to its source, then add <code>Console.print</code> to the signature, or press Reset, and generation resumes.</p>
</div>
</section>

<section id="tools" class="fh-row" aria-labelledby="ambition-heading">
<div class="fh-row__head">
<p class="fh-row__num">04</p>
<h2 id="ambition-heading">One descriptor. Every tool.</h2>
</div>
<div class="fh-row__body">
<p>A form's descriptor already teaches the compiler its checks, the language server its hover and search, and this site its <a href="/preludes/">reference pages</a>. Nobody maintains a second description of the keyword for tooling.</p>
<div class="fh-window">
<div class="fh-window__bar"><span>one descriptor, many readers</span></div>
<pre class="fh-ascii" v-pre aria-label="A prelude form descriptor is read by the compiler for slot checks, types, and effect sets; by the language server for diagnostics, hover, and workspace search; by this site for generated reference pages; and by code generation for typed IR and Effect TypeScript."><span class="fh-ascii__code">(form (rule name lanes clause ...) …)</span>
   │
   ├─ <b>compiler</b>    slot checks · HM types · effect sets
   ├─ <b>editor</b>      diagnostics · hover · search by IR type
   ├─ <b>reference</b>   generated prelude pages
   └─ <b>artifacts</b>   typed IR · Effect TypeScript</pre>
</div>
<p class="fh-row__after">A new language should feel as supported as a built-in one.</p>
<p>Workspace search ranks forms and definitions by their names and documentation, and filters by the IR type they produce. An author or a coding agent can ask which form builds an <code>Endpoint</code> instead of grepping preludes; the language server answers the same query as <code>workspace/symbol</code>.</p>
</div>
</section>

<section id="lisps" class="fh-row" aria-labelledby="lisps-heading">
<div class="fh-row__head">
<p class="fh-row__num">05</p>
<h2 id="lisps-heading">One kernel. Many Lisps.</h2>
<span class="fh-status">Direction · RFC 0021 and 0022</span>
</div>
<div class="fh-row__body">
<p>Types, effects, and contracts don't depend on spelling. The plan is to make every surface a library, Forma's own included, and to let a Lisp dialect plug into the same checker through a language adapter. Elaborators may propose terms and types; a small trusted kernel decides what is well typed.</p>
<p>The first step ships today: Clojure spellings are an ordinary macro library. Part of the reason is practical: coding agents write <code>defn</code>, <code>if-let</code>, and <code>-&gt;</code> out of habit, and a library can accept those spellings where the engine used to reject them. We haven't yet measured whether that reduces repair rounds; the later stages of RFC 0021 wait on that benchmark. <a href="/clojure">See what it does, and what it refuses →</a></p>
<div class="fh-window fh-window--tabs">

::: code-group

<<< @/snippets/clojure/orders.excerpt.lisp [orders.lisp]

<<< @/snippets/clojure/orders.checked.txt [checked interface]

:::

</div>
<p>This changes spelling only: <code>if</code> still takes a <code>Bool</code>, and <code>nil</code> is not <code>None</code>. The rest is proposed:</p>
<ul class="fh-checklist" aria-label="What is shipped and what is proposed for multiple Lisps">
<li><span><strong>Typed forms in preludes</strong>Slot types, scope, checks, and IR checked against a declared type.</span><em>engine</em></li>
<li><span><strong>Clojure spellings as a library</strong><code>defn</code>, <code>if-let</code>, and friends expand to core Forma. <a href="/clojure">The guide</a> shows a checked example.</span><em>preludes</em></li>
<li class="is-planned"><span><strong>A trusted kernel</strong>Re-checks every elaborated program, so a buggy prelude can't make an ill-typed program pass.</span><em><a href="https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-programmable-type-system.md">RFC 0022</a></em></li>
<li class="is-planned"><span><strong>Bidirectional elaborators</strong>Domain rules that receive expected types and emit checked terms.</span><em><a href="https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-programmable-type-system.md">RFC 0022</a></em></li>
<li class="is-planned"><span><strong>Languages as libraries</strong>Forma's own surface first, then a Clojure surface over Forma semantics.</span><em><a href="https://github.com/bjacobso/forma/blob/main/docs/rfcs/0021-languages-as-libraries.md">RFC 0021</a></em></li>
<li class="is-planned"><span><strong>Existing Lisp code</strong>Declaration files and a gradual boundary for Clojure, then a second dialect on the same kernel.</span><em><a href="https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-programmable-type-system.md">RFC 0022</a></em></li>
</ul>
</div>
</section>

<section id="targets" class="fh-row" aria-labelledby="targets-heading">
<div class="fh-row__head">
<p class="fh-row__num">06</p>
<h2 id="targets-heading">Emit the Lisp your host already runs.</h2>
<span class="fh-status">Direction · RFC 0021 stage 6</span>
</div>
<div class="fh-row__body">
<p>A domain language is worth most where its consumers already are. The plan is to write a policy, schema, or workflow once, check it with one kernel, and emit <strong>Clojure, Racket, Scheme, or Common Lisp source</strong> that runs on the host a team already operates: no Forma runtime to install, no second type system to adopt.</p>
<p>The design makes a declarative surface invertible, so running a Lisp surface backwards over checked core terms is most of an emitter. The rest is a kernel port and a differential run of the conformance corpus.</p>
<div class="fh-window">
<div class="fh-window__bar"><span>one checked core, many Lisps</span><span>proposed · RFC 0021</span></div>
<pre class="fh-ascii" v-pre aria-label="An emitter for a Lisp target is three steps: resugaring checked core terms through the target surface's own templates, a kernel port that implements tagged values, match, Option, records, sets, and Forma's numeric and string semantics including the checked Int range, and differential conformance that runs the conformance corpus on the target and compares it with the TypeScript VM's stored goldens."><span class="fh-ascii__code">core terms</span>  one checked program · one contract
   │
   ├─ 1 <b>resugar</b>       core → the target's own spellings
   ├─ 2 <b>kernel port</b>   tagged values · match · Option · records
   └─ 3 <b>conformance</b>   the corpus vs. the TypeScript VM goldens</pre>
</div>
<div class="fh-table">

| Target | Surface | Emitter | Where it would run |
| --- | --- | --- | --- |
| **Clojure** | <span class="fh-status is-live">Shipped</span> as [`preludes/modules/clojure.lisp`](/clojure) | <span class="fh-status">Proposed · first</span> | The JVM and JavaScript, from one `.cljc` file |
| **Racket** | <span class="fh-status">Proposed</span> brackets and `#t` are reader switches | <span class="fh-status">Proposed · second</span> | Racket |
| **Scheme** | <span class="fh-status">Proposed</span> the same reader switches | <span class="fh-status">Proposed · third</span> | R7RS implementations |
| **Common Lisp** | <span class="fh-status">Proposed</span> last: `funcall` and `#'f` are semantics, not spelling | <span class="fh-status">Proposed · last</span> | ANSI implementations such as SBCL |
| **All four** | One program, checked once | One kernel port each | Pinned against the TypeScript VM's goldens |

</div>
<p class="fh-row__after">Check it once. Run it where the work is.</p>
<p>Only the Clojure spellings library is shipped, and it changes spelling, not semantics. Every emitter here is proposed: effectful programs stay TypeScript-only until a target has an effect runtime, and each back end needs a concrete consumer and a conformance target before it is built. The targets, their semantic gaps, and the gate for each are in <a href="https://github.com/bjacobso/forma/blob/main/docs/rfcs/0021-languages-as-libraries.md">RFC 0021</a> and <a href="https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-programmable-type-system.md">RFC 0022</a>.</p>
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
<li><span><strong>Live playground</strong>The browser compiler runs prelude vocabularies such as email rules and Elm commands.</span><em>@forma-language/forma</em></li>
<li><span><strong>Refined contracts</strong><code>:pattern</code>, <code>:min-length</code>, <code>:min</code>, and <code>:max</code> on IR fields, checked where the author wrote them and generated as Schema filters.</span><em>engine</em></li>
<li><span><strong>Modules and packages</strong>Explicit imports and exports, <code>forma.json</code>, a verified <code>forma.lock</code>, and committed vendor sources. <a href="/modules">File modules</a></span><em>engine</em></li>
<li><span><strong>Editor support</strong>Diagnostics, hover, and workspace search by name, documentation, or IR type.</span><em>language server</em></li>
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
<a href="/clojure"><span>Lisp surfaces</span><strong>Clojure spellings, checked</strong><small><code>defn</code>, <code>if-let</code>, and <code>-&gt;</code> come from a library, and the guide shows the errors it refuses to paper over.</small><b>Read the guide →</b></a>
</div>
<a class="fh-link" href="/playground/demo" target="_self">All examples →</a>
</section>

<section class="fh-section" aria-labelledby="compare-heading">
<div class="fh-section__head">
<p class="fh-label">Alternatives</p>
<h2 id="compare-heading">Where Forma fits.</h2>
<p>Each approach covers part of this well. Forma's bet is that typing rules belong in libraries, checked by one small core.</p>
</div>
<div class="fh-table">

| | Who writes the typing rules | Checking | Output | Trade-off |
| --- | --- | --- | --- | --- |
| **Typed Clojure, Typed Racket, Coalton** | The type system's authors | Static types for Clojure, Racket, or Common Lisp code | Programs on the host runtime | A domain language gets the host's rules, not its own |
| **Turnstile** | Language authors, as Racket macros | Whatever the rules say; the rules are trusted | Racket programs | Racket only |
| **Racket `#lang`** | Language authors | Whatever you build | Programs on the Racket runtime | Hard to embed in a TypeScript or browser stack |
| **Schemas** (Malli, JSON Schema) | Schema authors | Data, at runtime | Validators | Checks values, not the programs that build them |
| **Config languages** (CUE, Pkl, Dhall, Nickel) | The language's authors | Strong, for data | JSON, YAML, and other data | No new forms, no effect or capability tracking |
| **Forma** | Prelude authors, as typed forms | Hindley–Milner inference, form checks, effect sets | Typed IR (`application/vnd.forma.ir+json`), Effect TypeScript | Pre-alpha, one Lisp surface and one generated target so far |

</div>
</section>

<section class="fh-section" aria-labelledby="embed-heading">
<div class="fh-section__head">
<p class="fh-label">Engine</p>
<h2 id="embed-heading">Built to embed.</h2>
<p>One TypeScript engine runs behind a JSON host ABI in Node, the browser, and editor tooling, and stored fixtures pin its behavior.</p>
</div>
<div class="fh-facts">
<article><h3>One package</h3><p><code>@forma-language/forma</code> contains the TypeScript engine, host, editor adapters, and language server. The engine runs in Node and in the browser.</p></article>
<article><h3>CLI and embedding</h3><p><code>forma check</code>, <code>run</code>, <code>test</code>, <code>fmt</code>, <code>repl</code>, and <code>describe</code> serve the human workflow. <code>forma mcp</code> serves agents; <code>createLanguage</code> embeds the same language services.</p></article>
<article><h3>Conformance</h3><p>Fixtures and reviewed goldens pin parsing, typing, evaluation, and IR output, and CI checks the engine against them.</p></article>
<article><h3>Repair loop</h3><p>Typed holes such as <code>?name</code> expose expected types. Diagnostics carry source spans, explanations, and repair information for editors and agents.</p></article>
</div>
<p class="fh-proof"><a href="https://worldvm.com">WorldVM's world language is a Forma prelude.</a></p>

Install from npm (Node.js 22.19 or later):

```sh
npm install @forma-language/forma effect
npx forma help
```

Or from a checkout of `main` (pnpm 10.20):

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@forma-language/forma
node packages/forma/dist/cli.mjs help
```

To install a tarball packed from `main`, after that build:

```sh
mkdir -p .context/tarballs
pnpm --filter @forma-language/forma pack --pack-destination ../../.context/tarballs
# In your consumer project, use the actual tarball filename printed above:
npm install /absolute/path/to/forma/.context/tarballs/forma-language-forma-*.tgz effect@4.1.1
```

[Publishing](/publishing) records the release checks and publication gates.

</section>

<section class="fh-section" aria-labelledby="status-heading">
<div class="fh-section__head">
<p class="fh-label">Before you bet on it</p>
<h2 id="status-heading">Pre-alpha research, with honest edges.</h2>
</div>
<div class="fh-notes-grid">
<dl class="fh-notes">
<div><dt>It is pre-alpha research.</dt><dd>Packages are 0.x and change without notice. There are no stable APIs, wire formats, or host ABI yet.</dd></div>
<div><dt>Releases lag <code>main</code>.</dt><dd>npm has the last released version; to try unreleased changes, run the CLI from a checkout or install a tarball packed from <code>main</code>. See <a href="/publishing">Publishing</a> for the distribution contract and release gates.</dd></div>
<div><dt>Some browser output is stored.</dt><dd>The playground does not run ontology elaboration yet; those examples show a stored canonical IR golden that CI checks against the TypeScript engine.</dd></div>
<div><dt>One generated target.</dt><dd>Effect TypeScript and Effect Schema are generated today. Lisp emitters, starting with <code>.cljc</code>, and Go and Rust Effect hosts are proposals in <a href="https://github.com/bjacobso/forma/blob/main/docs/rfcs/0021-languages-as-libraries.md">RFC 0021</a> and the <a href="https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-effect-hosts.md">Effect hosts RFC</a>, not built.</dd></div>
<div><dt>One Lisp surface.</dt><dd>Forma's own syntax is the only surface; Clojure spellings are macros over it. The trusted kernel, elaborator API, and dialect adapters are proposals in <a href="https://github.com/bjacobso/forma/blob/main/docs/rfcs/0021-languages-as-libraries.md">RFC 0021</a> and <a href="https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-programmable-type-system.md">RFC 0022</a>.</dd></div>
</dl>

<pre class="fh-ascii fh-ascii--card" v-pre aria-label="Working today: lossless reader and formatter, macros, Hindley–Milner and effect inference, refined contracts, canonical IR with contract identities, file modules and offline packages, Effect TypeScript and Schema generation, the browser playground and language server, and conformance goldens. Not yet: npm publication, a stable host ABI, a trusted kernel and elaborator API, Lisp dialect adapters, emitters for Clojure, Racket, Scheme, and Common Lisp, Go and Rust Effect hosts, and effect-polymorphic signatures.">working today
<span class="tone-ok">✓</span> reader · formatter · macros
<span class="tone-ok">✓</span> HM inference · effect inference
<span class="tone-ok">✓</span> refined contracts
<span class="tone-ok">✓</span> canonical IR · contract identity
<span class="tone-ok">✓</span> file modules · offline packages
<span class="tone-ok">✓</span> Effect TypeScript + Schema
<span class="tone-ok">✓</span> playground · language server
<span class="tone-ok">✓</span> conformance goldens
<span class="tone-ok">✓</span> human CLI · MCP · createLanguage
<span class="tone-ok">✓</span> typed holes · repair diagnostics

not yet
<span class="tone-muted">○</span> npm publication
<span class="tone-muted">○</span> stable host ABI
<span class="tone-muted">○</span> trusted kernel · elaborators
<span class="tone-muted">○</span> Lisp dialect adapters
<span class="tone-muted">○</span> Clojure / Racket / Scheme / CL emitters
<span class="tone-muted">○</span> Go / Rust Effect hosts
<span class="tone-muted">○</span> effect-polymorphic signatures</pre>

</div>
<div class="fh-columns">
<div class="fh-list fh-list--yes">
<h3>A good fit</h3>
<ul>
<li>Your schemas, endpoints, workflows, or policies are spread across files that drift.</li>
<li>You're building a domain language and want its rules checked at compile time, with real diagnostics and inspectable passes, instead of a hand-rolled parser and checker.</li>
<li>Reviewers need to see what authored code can fail with and what it can touch.</li>
<li>Agents write more of your domain code than people read, and you'd rather review a checked contract than every generated line.</li>
</ul>
</div>
<div class="fh-list fh-list--no">
<h3>Not a fit yet</h3>
<ul>
<li>General application programming. Forma isn't trying to replace Clojure, OCaml, or TypeScript.</li>
<li>Typechecking an existing Clojure, Racket, or Common Lisp codebase. That is a later, proposed stage.</li>
<li>Numeric or throughput-critical code.</li>
<li>Teams that need stable APIs or wire formats today.</li>
</ul>
</div>
</div>
</section>



</div>
