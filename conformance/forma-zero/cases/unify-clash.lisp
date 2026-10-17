; layer 1 — the same variable cannot bind two different values
(empty? (unify (concat ["x"] []) ["x" "a" "x"] ["p" "a" "q"] empty-env))
