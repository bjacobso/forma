(invoice-seed Invoice "invoice:zero"
  {:specification "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0"
   :process "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
   :number "INV-ZERO" :issue-date "2026-10-17" :type-code "380" :currency "EUR"
   :buyer-reference "BUYER-1" :due-date "2026-11-17"
   :seller "party:seller" :buyer "party:buyer"
   :lines ["line:zero"]
   :breakdowns ["vat:zero"]
   :line-total 2500 :without-vat 2500 :vat-total 0 :with-vat 2500 :due 2500})
