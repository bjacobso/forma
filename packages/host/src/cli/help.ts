export const usage = `Usage: forma <command>

Human commands:
  check <entry.lisp> [--json]          Typecheck a module graph.
  run <entry.lisp> [--unchecked] [--json]
                                      Check, then print the evaluated value.
  fmt <files...> [--check] [--json]    Format in place, or list files that would change.
  repl [--prelude <file>]...          Start a typed, stateful REPL.
                                      :quit, :type <expr>, :reset
  explain <code> [--json]             Explain a diagnostic offline.
  help                                Print this help.

Machine commands (JSON):
  file typecheck <entry.lisp>          Typecheck a module graph.
  file evaluate [--unchecked] <entry.lisp>
                                      Check, then evaluate (--unchecked skips checking).
  file declarations <entry.lisp>       List declarations and form application IR.
  file interface <entry.lisp>          Print module interfaces.
  schema <sources...> --out <dir> [--check]
                                      Generate data codecs, types, and JSON Schema.
  request ['<json>']                   Handle one JSON request (argument or stdin).
  daemon                              Handle one JSON request per stdin line.
  add <name> <spec> | update [name] | verify | vendor
                                      Manage packages.
  version                             Print the version.

Human diagnostics go to stderr. --json prints a JSON response on stdout.
Check, run, fmt and file commands exit 1 on failure; usage errors exit 64.
`;
