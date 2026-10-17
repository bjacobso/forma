(invoice-seed InvoiceLine "line:bad-s"
  {:number "4" :quantity 1 :unit "C62" :item-name "Wrong standard rate"
   :price 100 :net 100 :category "S" :rate-bps 0})
(invoice-seed InvoiceLine "line:bad-z"
  {:number "5" :quantity 1 :unit "C62" :item-name "Wrong zero rate"
   :price 100 :net 100 :category "Z" :rate-bps 2000})
