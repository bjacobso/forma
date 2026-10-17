(invoice-seed PostalAddress "address:seller"
  {:street "1 Market Street" :city "Berlin" :postcode "10115" :country "DE"})
(invoice-seed PostalAddress "address:buyer"
  {:street "2 High Street" :city "Paris" :postcode "75001" :country "FR"})
(invoice-seed InvoiceParty "party:seller"
  {:name "Example Seller" :address "address:seller" :vat-id "DE123456789"
   :endpoint "seller@example.test" :endpoint-scheme "EM"})
(invoice-seed InvoiceParty "party:buyer"
  {:name "Example Buyer" :address "address:buyer" :vat-id "FR12345678901"
   :endpoint "buyer@example.test" :endpoint-scheme "EM"})
