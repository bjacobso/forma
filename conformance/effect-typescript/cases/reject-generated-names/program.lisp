;; Distinct Forma names that become the same TypeScript name, and names
;; the generated module needs for Effect and JavaScript, are rejected.
(: foo-bar (-> Int Int))
(define foo-bar  [n] n)

(: fooBar (-> Int Int))
(define fooBar  [n] n)

(type Effect {:id String})

(: Math Int)
(define Math 1)

(service Inventory
  (: get-count (-> String (Effect Int [] [])))
  (: getCount (-> String (Effect Int [] [])))
  (: move (-> String String (Effect Unit [] []))))
