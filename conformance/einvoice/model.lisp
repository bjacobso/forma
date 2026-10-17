; Flat entities and repeated ID references, not nested UBL groups.
(entity PostalAddress {:street String :city String :postcode String :country String})
(entity InvoiceParty {:name String :address (Id PostalAddress) :vat-id String
                      :endpoint String :endpoint-scheme String})
(entity InvoiceLine {:number String :quantity Int :unit String :item-name String
                     :price Int :net Int :category (Union "S" "Z") :rate-bps Int})
(entity VatBreakdown {:category (Union "S" "Z") :rate-bps Int :taxable Int :tax Int
                      :exemption-reason (Option String) :exemption-code (Option String)})
(entity Invoice {:specification String :process String :number String :issue-date String
                 :type-code String :currency String :buyer-reference String :due-date String
                 :seller (Id InvoiceParty) :buyer (Id InvoiceParty)
                 :lines (List (Id InvoiceLine)) :breakdowns (List (Id VatBreakdown))
                 :line-total Int :without-vat Int :vat-total Int :with-vat Int :due Int})
