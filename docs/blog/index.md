---
title: Blog
description: Notes from building Forma in public, starting with a twelve-part series on building a typed Lisp from first principles with Effect TypeScript.
---

# Blog

Notes from building Forma in public.

## In the Beginning Was the Schema

A twelve-part series on building a typed Lisp from first principles with
Effect TypeScript. It starts with a fifty-line interpreter and ends with a
typed, extensible language for building other languages.

> Lisp makes programs into data. Schema makes data meaningful. Effect makes
> meaning executable.

[About the series →](./in-the-beginning/)

## Posts

<ul class="blog-posts">
<li>
<a href="/blog/in-the-beginning/12-let-there-be-languages"><span class="blog-posts__part">Part 12</span> Let There Be Languages</a>
<p>Declare forms in the language itself, build a vendor-review policy language from them, and run it with Effect services each host provides. The end of the series.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
<li>
<a href="/blog/in-the-beginning/11-agent-can-read-the-language"><span class="blog-posts__part">Part 11</span> The Agent Can Read the Language</a>
<p>Give a coding agent schema-described tools instead of a text buffer: reports, types at positions, a rename the checker proves safe, structured replacement, and a sandboxed REPL.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
<li>
<a href="/blog/in-the-beginning/10-many-interpretations"><span class="blog-posts__part">Part 10</span> One Program, Many Interpretations</a>
<p>Build a formatter, an analyzer, hover, and checked documentation over the language's typed representations, and combine them into one report with Effect.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
<li>
<a href="/blog/in-the-beginning/09-effects-are-part-of-the-type"><span class="blog-posts__part">Part 09</span> Effects Are Part of the Type</a>
<p>Give function types a row of effects, add when, catch, and race, and let a host reject a program that needs a capability it doesn't have, before it runs.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
<li>
<a href="/blog/in-the-beginning/08-prelude-is-the-language"><span class="blog-posts__part">Part 08</span> The Prelude Is the Language</a>
<p>Shrink the compiler to a kernel of numbers, names, and calls, build lambda, a generalizing let, if, and match as typed forms, and run a pricing language on the same kernel.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
<li>
<a href="/blog/in-the-beginning/07-macros"><span class="blog-posts__part">Part 07</span> Macros Are Programs About Programs</a>
<p>Add quasiquotation and pattern-based macros written in the language, make them hygienic by renaming, and see why homoiconicity alone isn't enough.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
<li>
<a href="/blog/in-the-beginning/06-interpreter-becomes-compiler"><span class="blog-posts__part">Part 06</span> The Interpreter Becomes a Compiler</a>
<p>Elaborate surface syntax into a small typed core with resolved names, run it with an evaluator that trusts it, and save it as a Schema-checked artifact.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
<li>
<a href="/blog/in-the-beginning/05-types-before-execution"><span class="blog-posts__part">Part 05</span> Types Before Execution</a>
<p>Represent types with Effect Schema, infer them with unification, and reject ill-typed programs before they run.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
<li>
<a href="/blog/in-the-beginning/04-environment-is-not-the-world"><span class="blog-posts__part">Part 04</span> The Environment Is Not the World</a>
<p>Add lambda, closures, and lexical scope, and separate the names a program defines from the capabilities a host grants through Effect services.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
<li>
<a href="/blog/in-the-beginning/03-errors-are-not-exceptions"><span class="blog-posts__part">Part 03</span> Errors Are Not Exceptions</a>
<p>Rewrite the evaluator as an Effect with named, Schema-backed failures, selective recovery, and a clear line between program errors and interpreter bugs.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
<li>
<a href="/blog/in-the-beginning/02-list-became-schema"><span class="blog-posts__part">Part 02</span> And the List Became Schema</a>
<p>Give s-expressions a schema and source spans, and turn parsing into a Schema transformation with structured diagnostics.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
<li>
<a href="/blog/in-the-beginning/01-the-list"><span class="blog-posts__part">Part 01</span> In the Beginning Was the List</a>
<p>Build the smallest Lisp imaginable, then see why code-as-data matters more than parentheses.</p>
<time datetime="2026-11-08">November 8, 2026</time>
</li>
</ul>
