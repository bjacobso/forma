---
layout: home
title: Clojure spellings in Forma
description: preludes/clojure.forma is an ordinary macro library that gives Forma modules Clojure's spellings — def, defn, defn-, if-let, when-let, if-not, when-not, comment, and threading. It changes spelling, not semantics; types, nil, and numbers stay Forma's.
sidebar: false
aside: false
pageClass: forma-index
---

<div class="forma-home">

<header class="fh-hero" aria-labelledby="hero-title">
<div class="fh-hero__copy">
<p class="fh-eyebrow">Clojure in Forma <span>· a shipped library · pre-alpha</span></p>
<h1 id="hero-title">Clojure's spellings. Forma's types.</h1>
<p class="fh-sub">Eight macros in one file, imported like any other module.</p>
<p class="fh-lead"><code>preludes/clojure.forma</code> gives a module <code>def</code>, <code>defn</code>, <code>defn-</code>, <code>if-let</code>, <code>when-let</code>, <code>if-not</code>, <code>when-not</code>, <code>comment</code>, and threading. Every one is an ordinary macro that expands to core Forma, so the program it produces is checked by Hindley–Milner inference and carries Forma's effects and contracts. It is <strong>spelling, not semantics</strong>: <code>if</code> takes a <code>Bool</code>, absence is <code>Option</code>, and <code>nil</code> is a <code>Unit</code> value.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="#example">See a checked example ↓</a>
<a class="fh-button" href="#library">Read the library</a>
</div>
</div>
<div class="fh-hero__side">
<div class="fh-window">
<div class="fh-window__bar"><span class="fh-window__dots" aria-hidden="true"><i></i><i></i><i></i></span><span>orders.forma</span><span>a conformance fixture</span></div>

<<< @/snippets/clojure/orders.excerpt.forma

</div>
<p class="fh-hero__note">Stage 0 of <a href="https://github.com/bjacobso/forma/blob/main/docs/rfcs/0021-languages-as-libraries.md">RFC 0021</a> · <a href="#stops">where Clojure habits stop</a></p>
</div>
</header>

<section id="scope" class="fh-section" aria-labelledby="scope-heading">
<div class="fh-section__head">
<p class="fh-label"><span>01</span> Scope</p>
<h2 id="scope-heading">What ships, and what does not.</h2>
<p>"Clojure support" could mean four different things. Exactly one of them exists today, and this page is only about that one.</p>
</div>
<div class="fh-table">

| | What it would mean | Status |
| --- | --- | --- |
| **A spelling library** | Clojure's familiar heads as macros over Forma semantics | <span class="fh-status is-live">Shipped</span> `preludes/clojure.forma`, this page |
| **A Clojure surface** | A language with Clojure's reader, `(:key m)`, `#{...}`, and its own diagnostics | <span class="fh-status">Proposed</span> RFC 0021 stage 5 |
| **A Clojure adapter** | Typechecking existing `.clj` files, with declaration files and a gradual boundary | <span class="fh-status">Proposed</span> RFC 0022 stage 5 |
| **A Clojure backend** | Emitting `.cljc` that runs on the JVM and in ClojureScript | <span class="fh-status">Proposed</span> RFC 0021 stage 6 |
| **Today** | Write Forma, spell it like Clojure, run it on the Forma engine | Nothing on this page runs on a JVM |

</div>
<div class="fh-prose">

The library exists because of one small engine change. Forma used to reject `def`, `defn`, `defmacro`, `lambda`, and `let*` in the reader, before any library could claim them. Those spellings are now rejected *after* expansion, so a macro in scope may define what they mean — and if none is, the old message still arrives at the form you wrote:

</div>
<div class="fh-window"><div class="fh-window__bar"><span>report.forma, with nothing imported</span><span>real diagnostic</span></div>

<<< @/snippets/clojure/unimported.txt

</div>
</section>

<section id="library" class="fh-section" aria-labelledby="library-heading">
<div class="fh-section__head">
<p class="fh-label"><span>02</span> The library</p>
<h2 id="library-heading">Eight macros, and nothing privileged.</h2>
<p>This is the whole thing. Each macro is a template over core Forma: <code>defn</code> builds a <code>define</code> of a <code>fn</code>, and <code>if-let</code> builds a <code>match</code> on <code>Option</code>. Nothing here is privileged — a prelude you write has the same powers.</p>
</div>
<div class="fh-window fh-window--full"><div class="fh-window__bar"><span>preludes/clojure.forma</span><span>bundled library, verbatim</span></div>

<<< @/../preludes/clojure.forma

</div>
<div class="fh-facts">
<article><h3><code>def</code>, <code>defn</code>, <code>defn-</code></h3><p>Expand to <code>define</code>. A docstring or attribute map before the parameter vector is accepted and dropped, because <code>define</code> has no docstring slot.</p></article>
<article><h3><code>if-let</code>, <code>when-let</code></h3><p>Expand to <code>match</code> on <code>Option</code>. They bind the value inside <code>Some</code>; they do not test truthiness.</p></article>
<article><h3><code>if-not</code>, <code>when-not</code>, <code>comment</code></h3><p>Ordinary templates. <code>when-not</code> yields <code>nil</code>, which in Forma is a <code>Unit</code> value.</p></article>
<article><h3><code>-&gt;</code>, <code>-&gt;&gt;</code></h3><p>Re-exported from <code>kernel.forma</code>, where they already lived. Threading is the one Clojure habit Forma always had.</p></article>
</div>
</section>

<section id="example" class="fh-section" aria-labelledby="example-heading">
<div class="fh-section__head">
<p class="fh-label"><span>03</span> An example</p>
<h2 id="example-heading">A module that reads like Clojure and checks like Forma.</h2>
<p>This is <a href="https://github.com/bjacobso/forma/blob/main/conformance/clojure-spellings/orders.forma">a conformance fixture</a>, not a sketch. The engine checks it on every run of <code>pnpm check</code>, and the interface below is its own output.</p>
</div>
<div class="fh-window fh-window--full"><div class="fh-window__bar"><span>conformance/clojure-spellings/orders.forma</span><span>the source</span></div>

<<< @/../conformance/clojure-spellings/orders.forma

<div class="fh-window__bar fh-window__bar--run"><span>the checked interface</span><span>inferred, not written</span></div>

<<< @/snippets/clojure/orders.checked.txt

</div>
<div class="fh-prose">

Three things in that output are worth naming.

- **The annotations are checked, not decorative.** `(: quote-for (-> Int (Option Int) String))` is verified against the body. Drop it and inference still runs, but unannotated arithmetic widens to `Float`, so the signature you get is `(-> Float (Option Float) String)`.
- **`receipt` was evaluated while the module was checked.** `"4400 cents"` is a compile-time value in the module's interface, not a test assertion written by hand.
- **The coupon is an `Option Int`.** `if-let` binds what is inside `Some`. There is no truthy value and no nil to pun on, which is the whole difference between this library and Clojure.

</div>
</section>

<section id="stops" class="fh-section" aria-labelledby="stops-heading">
<div class="fh-section__head">
<p class="fh-label"><span>04</span> Where habits stop</p>
<h2 id="stops-heading">Four Clojure reflexes the library does not carry over.</h2>
<p>Each block is the compiler's own diagnostic for <a href="https://github.com/bjacobso/forma/tree/main/conformance/clojure-spellings">a fixture in the repository</a>, located at the line and column you wrote — inside the <code>defn</code> body, not inside the macro expansion.</p>
</div>
<div class="fh-pair">
<div class="fh-window"><div class="fh-window__bar"><span>truthiness: (if coupon …)</span><span>real diagnostic</span></div>

<<< @/snippets/clojure/truthiness.txt

</div>
<div class="fh-window"><div class="fh-window__bar"><span>nil punning: nil for absence</span><span>real diagnostic</span></div>

<<< @/snippets/clojure/nil-punning.txt

</div>
<div class="fh-window"><div class="fh-window__bar"><span>keyword access: (:customer order)</span><span>real diagnostic</span></div>

<<< @/snippets/clojure/keyword-access.txt

</div>
<div class="fh-window"><div class="fh-window__bar"><span>set literal: #{"new" "vip"}</span><span>real diagnostic</span></div>

<<< @/snippets/clojure/set-literal.txt

</div>
</div>
<div class="fh-prose">

The first two are the design working: Forma's semantics win, and the error lands on the author's expression. The last two are the design's current edge. `(:key m)` and `#{…}` are not spellings a macro can claim — one needs an application-with-a-non-symbol-head rule, the other a reader switch. RFC 0021 calls these interposition points and lexical profiles, and they arrive with a surface, not with a macro library. Use `(get m :key)` until then.

</div>
</section>

<section id="limits" class="fh-section" aria-labelledby="limits-heading">
<div class="fh-section__head">
<p class="fh-label"><span>05</span> Limits</p>
<h2 id="limits-heading">Known rough edges.</h2>
<p>Everything below is current behavior, not a plan.</p>
</div>
<ul class="fh-checklist" aria-label="Known limits of the Clojure spellings library">
<li class="is-planned"><span><strong>One parameter vector</strong>A multi-arity <code>defn</code> fails with an arity error raised inside the macro, with no message and no span in your file. It is pinned as a fixture so that fixing it is visible.</span><em>gap</em></li>
<li class="is-planned"><span><strong><code>when-let</code> wants a <code>Unit</code> body</strong>Its <code>None</code> branch is <code>nil</code>, so a body that returns a value unifies that value with <code>Unit</code>. <code>(defn f [o] (when-let [v o] v))</code> infers <code>(-> (Option Unit) Unit)</code> instead of failing.</span><em>gap</em></li>
<li class="is-planned"><span><strong>Docstrings are dropped</strong><code>defn</code> accepts a docstring and an attribute map and discards both, because <code>define</code> has no docstring slot.</span><em>gap</em></li>
<li class="is-planned"><span><strong>No Clojure data or interop</strong>Atoms, dynamic vars, laziness, protocols, multimethods, and Java interop are not in scope for a macro library, and are not rejected with a message that names them yet.</span><em>RFC 0021 stage 5</em></li>
<li><span><strong><code>defn-</code> does not make anything private</strong>Forma modules export by name, so <code>defn-</code> is <code>defn</code>. A name is private because it is absent from <code>export</code>.</span><em>by design</em></li>
<li><span><strong>It is only in scope where it is imported</strong>No project-wide switch, no reader change, no effect on other modules. An unimported <code>defn</code> still reports the retired spelling.</span><em>by design</em></li>
</ul>
<div class="fh-prose">

The measurement that decides whether this goes further is an agent benchmark: do models writing Forma need fewer repair rounds when their Clojure habits parse? RFC 0021 holds its later stages behind that result.

</div>
</section>

<section id="next" class="fh-section" aria-labelledby="next-heading">
<div class="fh-section__head">
<p class="fh-label"><span>06</span> What's next</p>
<h2 id="next-heading">From spellings to a surface to a target.</h2>
<p>Each step is a proposal with a gate, and none is scheduled.</p>
</div>
<div class="fh-table">

| Step | What changes | Where it is written down |
| --- | --- | --- |
| **A Clojure surface** | A `language` declaration: a reader profile for `#{…}` and `#(…)`, `(:key m)` as an application rule, diagnostics in Clojure's terms, and `dialect/unsupported` naming each construct it cannot check | [RFC 0021](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0021-languages-as-libraries.md) stage 5 |
| **A trusted kernel** | A small checker that re-checks every elaborated program, so a surface cannot make an ill-typed program pass | [RFC 0022](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-programmable-type-system.md) stage 1 |
| **A Clojure adapter** | Checking existing Clojure source through declaration files, `Dynamic`, and casts | [RFC 0022](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-programmable-type-system.md) stage 5 |
| **A `.cljc` backend** | Running the surface backwards over checked core terms, plus a kernel port and differential conformance against the TypeScript VM | [RFC 0021](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0021-languages-as-libraries.md) stage 6 |
| **Today** | A macro library, one import away | [The library above](#library) |

</div>
<div class="fh-prose">

Racket, Scheme, and Common Lisp follow the same route, in that order. The homepage's [Lisp targets section](/#targets) has the short version, and RFC 0022's "Lisp targets" has the semantic gaps and the gate for each.

</div>
</section>

</div>
