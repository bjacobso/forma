# Legacy Ontology Root Fixture

This fixture intentionally has no `README.md`. It keeps `ontology.md` fallback
compatibility covered after product examples migrate to human-first `README.md`
roots.

```lisp
(ontology
  (:id "legacy-ontology-md-fixture")
  (:version "0.1.0")
  (:preludes core))

(entity LegacyThing {:name String})
```
