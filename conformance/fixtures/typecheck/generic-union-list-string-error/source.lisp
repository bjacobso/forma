(type Role (Union "manager" "finance"))
(: roles (List Role)) (define roles ["manager"])
(: same? (-> a a Bool)) (define same? [a b] (= a b))
(let [role "manager"] (same? roles [role]))
