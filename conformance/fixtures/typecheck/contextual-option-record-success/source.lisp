(type Details {:vendor (Option String) :asset-tag (Option String)})
(: valid? (-> Details Bool))
(define valid? [details]
  (match details.vendor (Some vendor) (= vendor "Acme") None false))
[(valid? {:vendor "Acme"}) (valid? {:vendor (Some "Acme") :asset-tag None})]
