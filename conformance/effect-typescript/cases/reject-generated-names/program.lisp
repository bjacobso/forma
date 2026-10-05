;; Distinct Forma names that become the same TypeScript name, and names
;; the generated module needs for Effect and JavaScript, are rejected.
(: foo-bar (-> Int Int))
(define foo-bar (fn [n] n))

(: fooBar (-> Int Int))
(define fooBar (fn [n] n))

(define-schema Effect (Struct (field id String)))

(: Math Int)
(define Math 1)

(define-service Inventory
  (:methods
    (get-count [sku String] (Effect Int [] []))
    (getCount [sku String] (Effect Int [] []))
    (move [from-bin String fromBin String] (Effect Unit [] []))))
