(invoice-seed VatBreakdown "vat:bad-s"
  {:category "S" :rate-bps 2000 :taxable 10000 :tax 1999
   :exemption-reason "Not permitted"})
(invoice-seed VatBreakdown "vat:bad-z"
  {:category "Z" :rate-bps 0 :taxable 2500 :tax 1
   :exemption-code "VATEX-EU-O"})
