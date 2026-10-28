---
title: Preludes
description: "Every Forma prelude with a reference generated from its source. Forms and slot types come from descriptors, signatures from (: name type) declarations, and documentation from docstrings and comments."
---

# Preludes

A prelude is a Forma source file that teaches the compiler new keywords. Each `form` descriptor names a keyword's slots, their types, the IR it produces, and optionally how it emits TypeScript. Swap the prelude and you have a different language on the same checked core.

Each reference page is generated from the prelude source when the site builds. Forms and slot types come from descriptors, function signatures from `(: name type)` declarations, and documentation from docstrings and the comments above each definition. Nothing is maintained separately, so a page cannot drift from its prelude.

::: info What the statuses mean
**Prototype** and **Spike** preludes run in the TypeScript engine and generate Effect TypeScript. **Stored output** means the playground shows a reviewed golden instead of recomputing it. **Conformance corpus** preludes are loaded by the conformance fixtures and the example corpus. **Protocol** preludes describe hosted wire formats.
:::

## Domain languages

<PreludeCards group="domain" />

## Core

<PreludeCards group="core" />

## Host protocols

<PreludeCards group="protocol" />

## Write your own

Start with [Writing a form](/writing-a-form), then read the [email prelude](/preludes/email): one form, three types, and six functions make a complete rule language. Hosts and the language server accept their own prelude paths, and [file modules](/modules) can export compile-time form libraries.

The reference generator currently lives in this site's build and is not packaged for other projects. A consumer-prelude SDK is on the [roadmap](/roadmap).
