(type Details {:vendor (Option String)})
(: valid? (-> Details Bool)) (define valid? [d] true)
(valid? {:vendor 42})
