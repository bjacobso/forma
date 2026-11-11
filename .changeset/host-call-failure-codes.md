---
"@forma-language/forma": patch
---

Keep a host's diagnostics when it resumes a host call with `{ok: false}`. The
failed evaluation's diagnostic now has the host's first code instead of
`KernelTypeError`, and `details.hostDiagnostics` carries every diagnostic the
host returned. `KernelTypeError` gains an optional `details` field that
survives source tracing and VM stack traces.
