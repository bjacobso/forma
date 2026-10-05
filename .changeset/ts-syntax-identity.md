---
"@formalang/ts": minor
"@formalang/host": minor
---

Add stable node identity for structural editors. `@formalang/ts/syntax` exports `identifySyntax`, which gives every syntax node and line comment an id, and `reconcileSyntax`, which carries ids to a new version of a document: nodes keep their ids when edits happen elsewhere, when they are retyped in place, and when they move with identical tokens. The trivia-preserving lexer now turns unterminated strings and unexpected characters into error nodes instead of throwing, so `parse` always returns a tree. `TsLanguageHost` implements the new optional `identifySyntax` host method.
