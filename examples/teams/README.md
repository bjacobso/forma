---
id: teams
version: 0.1.0
preludes:
  - core
---

# Teams

Small team topology example in canonical ontology syntax.

```lisp
(entity Team {:name String :focus (Option String)})
(entity Member {:name String :role (Option String) :team (Option (Id Team))})
```

```lisp
(seed Team "team:platform" {:name "Platform" :focus "Developer infrastructure"})
(seed Team "team:growth" {:name "Growth" :focus "Lifecycle experiments"})
(seed Member "member:alex"
  {:name "Alex Kim" :role "Staff Engineer" :team "team:platform"})
(seed Member "member:jordan"
  {:name "Jordan Lee" :role "Product Manager" :team "team:growth"})
```

```lisp
(query team-members :from Member :select [name role team])
```
