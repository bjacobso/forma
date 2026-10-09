(type Small (Omit (Merge (Pick {:a Int :b String} [:b]) {:c Bool}) [:c]))
(: small Small)
(define small {:b "ok"})
small
