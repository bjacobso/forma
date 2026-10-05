---
"@formalang/ts": patch
---

Make the outline codec keep its laws on every input. Printing an outline with its base reuses an unchanged row's exact text, children and all, so `print(read(s), base: s) = s` holds for any text, including whitespace after `(`, trailing spaces and carriage returns in comments, and unterminated strings at the end. Row texts are compared as written and never trimmed, so comment rows keep their ids. Printed rows with children are read back, and a row whose reused layout would read differently is printed with the canonical layout, so an edited outline printed with its base reads back as itself. Pieces are joined so a comment never runs into what follows it.
