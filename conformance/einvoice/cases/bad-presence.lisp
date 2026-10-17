(invoice-seed Invoice "invoice:presence"
  {:specification ""
   :process "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
   :number "" :issue-date "2026-10-17" :type-code "380" :currency "EUR"
   :buyer-reference "BUYER-1" :due-date "2026-11-17"
   :seller "party:seller" :buyer "party:buyer"
   :lines []
   :breakdowns ["vat:standard" "vat:reduced" "vat:zero"]
   :line-total 17500 :without-vat 17500 :vat-total 2250 :with-vat 19750 :due 19750})
