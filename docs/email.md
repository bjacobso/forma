---
layout: home
title: Forma for email automation
description: Email and marketing automation rules in a typed Lisp. A small prelude defines lanes, decisions, and predicates; a TypeScript-engine prototype checks each rule and generates Effect TypeScript before anything sends.
sidebar: false
aside: false
pageClass: forma-index forma-email
---

<div class="forma-home">

<header class="fh-hero" aria-labelledby="hero-title">
<div class="fh-blueprint" aria-hidden="true"></div>
<div class="fh-hero__copy">
<p class="fh-eyebrow"><span class="fh-dot"></span>Forma for email automation · pre-alpha prototype</p>
<h1 id="hero-title">Email automation you can review before it sends.</h1>
<p class="fh-lead">Who gets an email, when, and how fast. Write a campaign rule as a small Lisp form. Forma checks every lane, every decision, and every delivery failure, then generates plain Effect TypeScript for your sender. The whole vocabulary is one short prelude, shown in full below.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="#in-action">See it run <span aria-hidden="true">↓</span></a>
<a class="fh-button" href="#prelude">Read the prelude</a>
</div>
</div>
<div class="fh-hero__side">
<div class="fh-window"><div class="fh-window__bar"><span class="fh-window__dots" aria-hidden="true"><i></i><i></i><i></i></span><span>warmup.lisp</span><span>checked by the prototype</span></div>

<<< @/snippets/email/rule.lisp

</div>
<p class="fh-hero__note">Prelude-defined vocabulary · TypeScript engine only · <a href="#limits">current limits</a></p>
</div>
</header>

<section id="pitch" class="fh-section" aria-labelledby="pitch-heading">
<div class="fh-section__head">
<p class="fh-label"><span>01</span> The pitch</p>
<h2 id="pitch-heading">A campaign is a program. Check it like one.</h2>
</div>
<div class="fh-prose">

Marketing automation is mostly rules: hold this email if another one is about to land, skip people who already bought, send Gmail addresses on a slower lane so the domain keeps trusting you. Those rules usually live in a visual builder, a YAML file, and a throttling script. Nothing checks them together, so mistakes show up in someone's inbox.

Forma treats the rule as source code with a small, closed vocabulary:

- **Lanes are a type.** A rule's lanes become a union of names. Sending on `"gmial"` is a compile error at that clause, not a silent fallback onto the bulk lane.
- **Every contact gets exactly one decision.** Clauses apply top to bottom, and the rule must end with a decision for everyone else: `send`, `defer`, or `skip`.
- **Rules are pure.** A rule cannot call your mail provider, so it can be evaluated over a whole audience without sending anything.
- **Delivery failures are part of the contract.** If the provider can fail with `Bounced` or `RateLimited`, the code that sends must turn each failure into a decision.
- **The output is ordinary Effect.** Schemas, a tagged decision union, and an `Effect` with no escaped failures. No Forma runtime ships with it.

None of this is built into the compiler. The words a rule can use (`send`, `tag?`, `due?`, and the rest) are typed definitions in one prelude file. Change the prelude and the language changes with it.

</div>
</section>

<section id="prelude" class="fh-spread fh-tone-teal" aria-labelledby="prelude-heading">
<header class="fh-spread__head">
<span class="fh-spread__index" aria-hidden="true">02</span>
<div><p class="fh-spread__kicker">The prelude</p><h2 id="prelude-heading" class="fh-spread__name">preludes/email.lisp</h2></div>
<span class="fh-status is-live">Prototype · TypeScript engine</span>
</header>
<div class="fh-spread__body fh-spread__body--stack">
<div class="fh-facts">
<article><h3>The contact</h3><p><code>EmailContact</code> is what a rule can see about one recipient. Your host computes its fields, including <code>:due-in</code>, the hours until each journey's next scheduled email.</p></article>
<article><h3>The decisions</h3><p><code>EmailDecision</code> closes the set of answers. <code>send</code>, <code>defer</code>, and <code>skip</code> are ordinary typed functions that build them.</p></article>
<article><h3>The predicates</h3><p><code>tag?</code>, <code>domain?</code>, and <code>due?</code> are ordinary functions too. They take the contact first; a rule leaves it out.</p></article>
<article><h3>The form</h3><p><code>rule</code> declares the syntax and an emit hook for the exported rule record. The <a href="https://github.com/bjacobso/forma/blob/main/packages/ts/src/Email.ts">linker</a> adds the rule's lanes as <code>EmailLane</code>, passes the contact to predicates, and reads <code>6h</code> or <code>2d</code> as hours.</p></article>
</div>
<div class="fh-window fh-window--full"><div class="fh-window__bar"><span>email.lisp</span><span>bundled prelude, verbatim</span></div>

<<< @/../preludes/email.lisp

</div>
</div>
</section>

<section id="in-action" class="fh-live" aria-labelledby="in-action-heading">
<div class="fh-section__head">
<p class="fh-label"><span>03</span> In action</p>
<h2 id="in-action-heading">Break the rule. Watch it refuse to send.</h2>
<p>This workbench runs the email prelude and the Effect checker in your browser. The rule is followed by ordinary Effect code: a <code>Mailer</code> service and a <code>run-warmup</code> operation that delivers whatever the rule decides. <strong>Introduce error</strong> misspells the Gmail lane. Open <strong>Effect TypeScript</strong> to see fresh generated code.</p>
</div>
<div class="fh-hero__demo">

<WorkbenchEmbed example="email-rule" file="warmup.forma" title="Live email rule workbench" />

</div>
</section>

<section class="fh-section" aria-labelledby="catches-heading">
<div class="fh-section__head">
<p class="fh-label"><span>04</span> What it catches</p>
<h2 id="catches-heading">Four mistakes that would have sent the wrong email.</h2>
<p>Each diagnostic below is real compiler output for a one-line edit to the program above, located in the author's source.</p>
</div>
<div class="fh-pair">
<div class="fh-window"><div class="fh-window__bar"><span>a lane typo</span><span>real diagnostic</span></div>

<<< @/snippets/email/lane-typo.txt

</div>
<div class="fh-window"><div class="fh-window__bar"><span>the fallback send removed</span><span>real diagnostic</span></div>

<<< @/snippets/email/fallthrough.txt

</div>
<div class="fh-window"><div class="fh-window__bar"><span>bounce recovery removed</span><span>real diagnostic</span></div>

<<< @/snippets/email/unhandled-bounce.txt

</div>
<div class="fh-window"><div class="fh-window__bar"><span>skipped contacts ignored</span><span>real diagnostic</span></div>

<<< @/snippets/email/missing-arm.txt

</div>
</div>
</section>

<section id="output" class="fh-section" aria-labelledby="output-heading">
<div class="fh-section__head">
<p class="fh-label"><span>05</span> The output</p>
<h2 id="output-heading">Plain Effect TypeScript.</h2>
<p>This is the complete generated module for the program above, checked against <code>effect@4.0.3</code>. The <a href="https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript/cases/email-warmup">conformance case</a> compares it with a golden, typechecks it under strict settings, and runs a harness against recording, rate-limited, and bouncing mailers.</p>
</div>
<div class="fh-facts">
<article><h3>Schema-backed contacts</h3><p><code>EmailContact</code>, <code>EmailLane</code>, and <code>EmailDecision</code> are Effect schemas, so a host can decode contacts from a CRM export before a rule sees them.</p></article>
<article><h3>A rule record</h3><p><code>LaunchWarmup3</code> exports the rule's name, its <code>decide</code> function, and <code>perHour</code> for each lane. A scheduler reads rates from it.</p></article>
<article><h3>A provider service</h3><p><code>Mailer</code> is a <code>Context.Service</code>. You implement it for your provider and provide the layer when you run <code>runWarmup</code>.</p></article>
<article><h3>No escaped failures</h3><p><code>runWarmup</code> has type <code>Effect&lt;EmailDecision, never, Mailer&gt;</code>. Every declared provider failure has already become a decision.</p></article>
</div>
<div class="fh-window"><div class="fh-window__bar"><span>warmup.ts</span><span>actual generator output</span></div>

<<< @/snippets/email/warmup.ts

</div>
</section>

<section id="limits" class="fh-section" aria-labelledby="limits-heading">
<div class="fh-section__head">
<p class="fh-label"><span>06</span> Limits</p>
<h2 id="limits-heading">What you give up, and what isn't there.</h2>
<p>This is a small prototype on a pre-alpha language. The working part is the checker; most of an email platform is outside it.</p>
</div>
<div class="fh-columns">
<div class="fh-list fh-list--no"><h3>Trade-offs</h3><ul>
<li><strong>Two languages.</strong> Rules are Lisp; provider adapters, audience loading, and scheduling are TypeScript. Debugging follows generated code because source maps are absent.</li>
<li><strong>A fixed contact.</strong> Rules see the prelude's <code>EmailContact</code>. Adding a field or predicate means editing the prelude.</li>
<li><strong>No visual builder.</strong> Marketers who work in a drag-and-drop journey tool would need one built over this; none exists.</li>
</ul></div>
<div class="fh-list fh-list--no"><h3>Missing today</h3><ul>
<li><strong>Scope.</strong> One rule per source. No module linking, CLI command, or language-server support for these forms.</li>
<li><strong>A runtime.</strong> Forma checks that every lane has a rate. It does not schedule, enforce rates, retry later, deduplicate sends, or wake deferred contacts.</li>
<li><strong>The rest of email.</strong> No templates, audience queries, consent and unsubscribe handling, provider integrations, or deliverability tooling.</li>
</ul></div>
</div>
</section>

<section class="fh-section" aria-labelledby="next-heading">
<div class="fh-section__head">
<p class="fh-label"><span>07</span> Next</p>
<h2 id="next-heading">Run the campaign before it sends.</h2>
<p>Three proposed RFCs would turn checked rules into rehearsed ones. None of them is implemented.</p>
</div>
<div class="fh-facts">
<article><h3>Rule tests</h3><p><a href="/rfcs/0015-tests-in-forma">Tests in Forma</a> would let a rule carry its own examples: a customer is skipped, a new signup is deferred, a Gmail address takes the Gmail lane.</p></article>
<article><h3>Dry runs</h3><p><a href="/rfcs/0012-checked-evaluation">Checked evaluation</a> pauses each host call with its source span, so a dry run could answer every delivery with "recorded, not sent."</p></article>
<article><h3>Replay</h3><p><a href="/rfcs/0016-host-call-journals">Host-call journals</a> would record a real send, replay a changed rule against it, and report the first contact who would now get a different email.</p></article>
<article><h3>Open questions</h3><p>Should suppression be a separate, always-checked clause rather than first-match? Where should journey timing and multi-email sequences live? Should templates be checked against the contact schema too?</p></article>
</div>
</section>

<section class="fh-section" aria-labelledby="fit-heading">
<div class="fh-section__head">
<p class="fh-label"><span>08</span> Fit</p>
<h2 id="fit-heading">When to try it.</h2>
</div>
<div class="fh-columns">
<div class="fh-list fh-list--yes"><h3>Worth trying</h3><ul>
<li>Engineers who already own their email sending in TypeScript or Effect.</li>
<li>Writing audience and lane logic as checked rules, then calling the generated module from your own scheduler.</li>
<li>Exploring what a reviewable campaign language should look like before building one.</li>
</ul></div>
<div class="fh-list fh-list--no"><h3>Not yet</h3><ul>
<li>Replacing a marketing automation platform or a journey builder.</li>
<li>Anything that needs scheduling, rate enforcement, consent tracking, or templates from Forma.</li>
<li>Teams that need stable syntax, editor tooling, or a compatibility promise.</li>
</ul></div>
</div>
</section>

<section class="fh-closing" aria-labelledby="closing-heading">
<h2 id="closing-heading">Read the prelude, then try to break a rule.</h2>
<p>The prelude is the language. The conformance case shows the generated module and the mailers that exercise it.</p>
<div class="fh-actions">
<a class="fh-button fh-button--primary" href="#in-action">Edit the rule live</a>
<a class="fh-button" href="https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript/cases/email-warmup">Warm-up conformance</a>
<a class="fh-button" href="/effect">Forma for Effect</a>
</div>
</section>

</div>
