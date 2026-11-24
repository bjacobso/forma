;; RFC 0019 section 10: a declared operation stands wherever a lambda does.
(error UnknownSku {:sku String})
(service Catalog (: price (-> String (Effect (Option Int) [] []))))

(: price-line (-> String (Effect Int [UnknownSku] [Catalog.price])))
(define price-line [sku]
  (do! [found (Catalog.price sku)]
    (match found
      (Some cents) (succeed cents)
      None (fail (UnknownSku {:sku sku})))))

(: price-all (-> (List String) (Effect (List Int) [UnknownSku] [Catalog.price])))
(define price-all [skus] (for-each skus price-line))

(: price-all-concurrently (-> (List String) (Effect (List Int) [UnknownSku] [Catalog.price])))
(define price-all-concurrently [skus] (for-each skus price-line :concurrency 2))

(: shout (-> String (Effect String)))
(define shout [word] (succeed (str word "!")))

(: shout-all (-> (List String) (Effect (List String))))
(define shout-all [words] (for-each words shout))
