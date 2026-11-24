---
"@forma-language/forma": patch
---

Diagnostics show more of what is wanted. A form shape error echoes the form's canonical shape in `help` and `details.expected`, and repairs an options map written where the form takes keyword options; a `layer` written as `(layer Name Service {:method (fn ...)})` is repaired to `(layer Name :provides Service (define method ...))`. String keys in `(Refers X)` holes are checked against declarations like symbols, with a did-you-mean repair. Hole type and numeric argument errors name the expected and actual types (`(+ 1 "a")` now expects Int, not Float). A base value where a brand is expected offers the brand constructor, such as `(UserId "u-1")`. A step-limit error names the function that was running and how to make the work cheaper. REPL repairs now point into the cell they edit.
