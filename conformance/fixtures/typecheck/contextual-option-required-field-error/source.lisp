(type Details {:name String :vendor (Option String)})
(: valid? (-> Details Bool)) (define valid? [d] true)
(valid? {})
