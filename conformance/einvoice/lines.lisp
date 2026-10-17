; EUR 100.00 at 20%, EUR 50.00 at 5%, EUR 25.00 zero-rated.
(invoice-seed InvoiceLine "line:standard"
  {:number "1" :quantity 2 :unit "C62" :item-name "Standard goods"
   :price 5000 :net 10000 :category "S" :rate-bps 2000})
(invoice-seed InvoiceLine "line:reduced"
  {:number "2" :quantity 1 :unit "C62" :item-name "Reduced-rate goods"
   :price 5000 :net 5000 :category "S" :rate-bps 500})
(invoice-seed InvoiceLine "line:zero"
  {:number "3" :quantity 1 :unit "C62" :item-name "Zero-rated goods"
   :price 2500 :net 2500 :category "Z" :rate-bps 0})
(invoice-seed VatBreakdown "vat:standard"
  {:category "S" :rate-bps 2000 :taxable 10000 :tax 2000})
(invoice-seed VatBreakdown "vat:reduced"
  {:category "S" :rate-bps 500 :taxable 5000 :tax 250})
(invoice-seed VatBreakdown "vat:zero"
  {:category "Z" :rate-bps 0 :taxable 2500 :tax 0})
