(invoice-seed VatBreakdown "vat:wrong-s-base"
  {:category "S" :rate-bps 2000 :taxable 9000 :tax 1800})
(invoice-seed VatBreakdown "vat:wrong-z-base"
  {:category "Z" :rate-bps 0 :taxable 2400 :tax 0})
(invoice-seed Invoice "invoice:taxable"
  {:specification "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0"
   :process "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
   :number "INV-001" :issue-date "2026-10-17" :type-code "380" :currency "EUR"
   :buyer-reference "BUYER-1" :due-date "2026-11-17"
   :seller "party:seller" :buyer "party:buyer"
   :lines ["line:standard" "line:reduced" "line:zero"]
   :breakdowns ["vat:wrong-s-base" "vat:reduced" "vat:wrong-z-base"]
   :line-total 17500 :without-vat 17500 :vat-total 2050 :with-vat 19550 :due 19550})
