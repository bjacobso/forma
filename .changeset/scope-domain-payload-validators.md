---
"@forma-language/forma": patch
---

Scope bundled domain payload validators to descriptors that explicitly request `domain-payload`. Consumer IR kinds such as `Entity` and `Document` no longer accidentally select the bundled ontology contracts, including in mixed-prelude sessions. Bundled ontology forms opt in and retain their checks; consumer IR and hole contracts remain enforced.

No public signatures change. Breaking behavioral change for direct producers: hosts constructing canonical domain declarations directly must add `validators: ["domain-payload"]` to retain the bundled checks; legacy descriptors must request the named validator in their artifact extension. Custom registries used with bundled ontology forms must register that validator. The default registry already does so.
