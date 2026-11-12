# A checked embedding boundary
Write `rules.lisp`, `main.lisp`, and `gate.mjs` for a Node app. rules exports
message : Int -> String: <=7500 -> "auto", <=250000 -> "manager", otherwise
"finance"; private helpers must stay private. main imports message and evaluates
(message 7501). gate.mjs exports async openGate(createLanguage, {notify, steps}).
The first argument is the embedding facade (dependency injection for the app).
Return {check(source), run(source), close()} with async methods. Load rules.lisp
using createLanguage's `modules` (NOT preludes), read it relative to gate.mjs,
and expose exactly one capability `notify`: one String in, String out, using an
explicit typeScheme and async handler forwarding to supplied notify. Never call
notify during checking. Every run must use supplied steps as limits.steps;
checks and runs use sourceId "agent.lisp". Preserve the facade's results.
close must close the facade (including after failed programs); document usage in
a comment or README if helpful. Hidden tests pass real createLanguage, verify
valid calls, module auto-imports, private-name rejection, type-invalid code that
would perform an effect if evaluated, low-step termination, and independent
runs. The caller supplies createLanguage from @forma-language/forma; tests inject
the already built facade. No installation is needed. Read docs/embedding.md.

Target: 20–60 minutes. Write the requested files in the sandbox root. Do not edit supplied context.
Use `forma check main.lisp`, `forma file evaluate main.lisp`, and (for forms)
`forma file declarations main.lisp`. Hidden tests import your public API, vary
inputs, and check diagnostics and source locations. Use only `.lisp` for Forma
source. No network or dependencies are needed.
