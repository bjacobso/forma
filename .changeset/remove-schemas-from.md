---
"@forma-language/forma": minor
---

**Breaking:** Remove the RPC generator's `schemasFrom` option. To share generated domain schemas between RPC and HTTP modules, put the domain in its own file module and import it; each generated module imports the domain's generated module.
