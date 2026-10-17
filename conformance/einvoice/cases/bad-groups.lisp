(invoice-seed Invoice "invoice:groups"
  {:specification "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0"
   :process "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
   :number "INV-001" :issue-date "2026-10-17" :type-code "380" :currency "EUR"
   :buyer-reference "BUYER-1" :due-date "2026-11-17"
   :seller "party:seller" :buyer "party:buyer"
   :lines ["line:standard" "line:reduced" "line:zero"]
   :breakdowns ["vat:zero" "vat:zero"]
   :line-total 17500 :without-vat 17500 :vat-total 2250 :with-vat 19750 :due 19750})
