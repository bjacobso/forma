export const usage = `Usage: forma <command>

Human commands:
  check <entry.lisp> [--json]          Typecheck a module graph.
  run <entry.lisp> [--unchecked] [--json]
                                      Check, then print the evaluated value.
  test [paths...] [--json] [--filter <substring>]
                                      Check and run independent Forma tests.
  fmt <files...> [--check] [--json]    Format in place, or list files that would change.
  repl [--prelude <file>]...          Start a typed, stateful REPL.
                                      :quit, :type <expr>, :reset
  describe <entry.lisp | --prelude path> [--format md|json]
                                      Describe forms, functions, and types.
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
  mcp                                 Serve structured agent tools over MCP stdio.
  abi-schema                          Print the JSON Schema of every request and response.
  add <name> <spec> | update [name] | verify | vendor
                                      Manage packages.
  version                             Print the version.

Human diagnostics go to stderr. --json prints a JSON response on stdout.
Check, run, test, fmt and file commands exit 1 on failure; usage errors exit 64.
`;
