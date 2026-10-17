; Spike vocabulary over the current ontology prelude, not a UBL implementation.
; All money is Int cents; rates are Int basis points. No Float arithmetic.
(define einvoice/problem [code valid message]
  (if valid [] [{:severity :error :code (str "einvoice/" code)
                :slot :fields :message message}]))
(define einvoice/present? [value]
  (and (not (nil? value)) (not (= value ""))))
(define einvoice/record [id] (declaration-hole id :fields))
(define einvoice/sum [records field]
  (reduce (fn [total record] (+ total (get record field 0))) 0 records))
(define einvoice/category [records category]
  (filter (fn [record] (= (get record :category) category)) records))
(define einvoice/line-check [fields]
  (concat
    (einvoice/problem "BR-S-05"
      (or (not (= (get fields :category) "S")) (> (get fields :rate-bps) 0))
      "BR-S-05: an S line needs a positive VAT rate")
    (einvoice/problem "BR-Z-05"
      (or (not (= (get fields :category) "Z")) (= (get fields :rate-bps) 0))
      "BR-Z-05: a Z line needs a zero VAT rate")))
(define einvoice/breakdown-check [fields]
  (concat
    (einvoice/problem "BR-Z-09"
      (or (not (= (get fields :category) "Z")) (= (get fields :tax) 0))
      "BR-Z-09: a Z breakdown needs zero VAT")
    (einvoice/problem "BR-S-09-exact"
      (or (not (= (get fields :category) "S"))
          (= (* (get fields :tax) 10000)
             (* (get fields :taxable) (get fields :rate-bps))))
      "BR-S-09 exact-cent subset only: taxable cents * basis points = tax cents * 10000")
    (einvoice/problem "BR-S-10"
      (or (not (= (get fields :category) "S"))
          (and (nil? (get fields :exemption-reason)) (nil? (get fields :exemption-code))))
      "BR-S-10: an S breakdown must omit exemption reason and code")
    (einvoice/problem "BR-Z-10"
      (or (not (= (get fields :category) "Z"))
          (and (nil? (get fields :exemption-reason)) (nil? (get fields :exemption-code))))
      "BR-Z-10: a Z breakdown must omit exemption reason and code")))
(define einvoice/invoice-check [fields]
  (let [seller (einvoice/record (get fields :seller))
        buyer (einvoice/record (get fields :buyer))
        seller-address (einvoice/record (get seller :address))
        buyer-address (einvoice/record (get buyer :address))
        lines (map einvoice/record (get fields :lines []))
        breakdowns (map einvoice/record (get fields :breakdowns []))
        standard-lines (einvoice/category lines "S")
        zero-lines (einvoice/category lines "Z")
        standard-breakdowns (einvoice/category breakdowns "S")
        zero-breakdowns (einvoice/category breakdowns "Z")]
    (concat
      (flat-map
        (fn [[code field]]
          (einvoice/problem code (einvoice/present? (meta/get fields field))
            (str code ": invoice requires " field)))
        [["BR-01" :specification] ["BR-02" :number] ["BR-03" :issue-date]
         ["BR-04" :type-code] ["BR-05" :currency] ["BR-12" :line-total]
         ["BR-13" :without-vat] ["BR-14" :with-vat] ["BR-15" :due]])
      (einvoice/problem "BR-06" (einvoice/present? (get seller :name)) "BR-06: seller name required")
      (einvoice/problem "BR-07" (einvoice/present? (get buyer :name)) "BR-07: buyer name required")
      (einvoice/problem "BR-08" (not (nil? seller-address)) "BR-08: seller address required")
      (einvoice/problem "BR-09" (einvoice/present? (get seller-address :country)) "BR-09: seller country required")
      (einvoice/problem "BR-10" (not (nil? buyer-address)) "BR-10: buyer address required")
      (einvoice/problem "BR-11" (einvoice/present? (get buyer-address :country)) "BR-11: buyer country required")
      (einvoice/problem "BR-16" (> (count lines) 0) "BR-16: at least one invoice line required")
      (einvoice/problem "BR-CO-18" (> (count breakdowns) 0) "BR-CO-18: at least one VAT breakdown required")
      (einvoice/problem "BR-CO-10" (= (get fields :line-total) (einvoice/sum lines :net))
        "BR-CO-10: line total must equal the sum of line net amounts")
      ; No document allowances or charges in this slice.
      (einvoice/problem "BR-CO-13" (= (get fields :without-vat) (einvoice/sum lines :net))
        "BR-CO-13: total without VAT must equal the sum of line net amounts")
      (einvoice/problem "BR-CO-14" (= (get fields :vat-total) (einvoice/sum breakdowns :tax))
        "BR-CO-14: VAT total must equal the sum of breakdown tax amounts")
      (einvoice/problem "BR-CO-15" (= (get fields :with-vat) (+ (get fields :without-vat 0) (get fields :vat-total 0)))
        "BR-CO-15: total with VAT must equal total without VAT plus VAT")
      (einvoice/problem "BR-CO-16" (= (get fields :due) (get fields :with-vat))
        "BR-CO-16: due equals total with VAT when paid and rounding amounts are absent")
      (einvoice/problem "BR-S-01"
        (if (> (count standard-lines) 0)
          (> (count standard-breakdowns) 0) (= (count standard-breakdowns) 0))
        "BR-S-01: S breakdowns must be present exactly when S lines are present")
      (einvoice/problem "BR-Z-01"
        (or (and (= (count zero-lines) 0) (= (count zero-breakdowns) 0))
            (= (count zero-breakdowns) 1))
        "BR-Z-01: Z lines require exactly one Z breakdown")
      (einvoice/problem "BR-S-02" (or (= (count standard-lines) 0) (einvoice/present? (get seller :vat-id)))
        "BR-S-02: this slice uses seller VAT ID for S lines")
      (einvoice/problem "BR-Z-02" (or (= (count zero-lines) 0) (einvoice/present? (get seller :vat-id)))
        "BR-Z-02: this slice uses seller VAT ID for Z lines")
      (flat-map
        (fn [breakdown]
          (let [standard (= (get breakdown :category) "S")
                matching (if standard
                  (filter (fn [line] (= (get line :rate-bps) (get breakdown :rate-bps))) standard-lines)
                  zero-lines)]
            (einvoice/problem (if standard "BR-S-08" "BR-Z-08")
              (= (get breakdown :taxable) (einvoice/sum matching :net))
              "VAT taxable amount must equal matching line net amounts (no allowances or charges)")))
        breakdowns))))
; Same payload and schema/ID checks as ontology `seed`, plus domain checks.
; Core `constraint` declarations store runtime expressions; they do not execute
; them against seeds during elaboration, so this spike uses a :check hook.
(form (invoice-seed entity id fields)
  :types {:entity (Refers SchemaDecl) :id (Declares RecordDef String) :fields (Record Json)}
  :ir RecordIR
  :type RecordDef
  :check (fn [{:keys [entity fields]}]
    (let [schema-errors (schema/validate-record (seed-row entity) (seed-values entity fields))
          values (reduce (fn [record [key value]] (assoc record key value)) {} fields)]
      (if (> (count schema-errors) 0) schema-errors
        (cond
          (= entity (quote Invoice)) (einvoice/invoice-check values)
          (= entity (quote InvoiceLine)) (einvoice/line-check values)
          (= entity (quote VatBreakdown)) (einvoice/breakdown-check values)
          :else []))))
  {:kind "Record" :name id :id id :entity entity :fields (seed-assignments entity fields)})
