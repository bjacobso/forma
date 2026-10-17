(invoice-seed Invoice "invoice:totals"
  {:specification "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0"
   :process "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
   :number "INV-001" :issue-date "2026-10-17" :type-code "380" :currency "EUR"
   :buyer-reference "BUYER-1" :due-date "2026-11-17"
   :seller "party:seller" :buyer "party:buyer"
   :lines ["line:standard" "line:reduced" "line:zero"]
   :breakdowns ["vat:standard" "vat:reduced" "vat:zero"]
   :line-total 17499 :without-vat 17501 :vat-total 2251 :with-vat 19751 :due 19750})
