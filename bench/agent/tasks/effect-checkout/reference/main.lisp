(export Receipt Declined Payments Audit checkout retry-free preview)
(type Receipt {:id String :total Int})
(error Declined {:id String})
(service Payments (: charge (-> String Int (Effect Receipt [Declined]))))
(service Audit (: record (-> String (Effect Unit))))
(: preview (-> String Int Receipt))
(define preview [id total] {:id id :total (if (< total 0) 0 total)})
(: checkout (-> String Int (Effect Receipt [Declined] [Payments.charge Audit.record])))
(define checkout [id total]
 (if (< total 0) (fail (Declined {:id id}))
  (do! [receipt (Payments.charge id total) _ (Audit.record receipt.id)]
   (succeed receipt))))
(: retry-free (-> String Int (Effect Receipt [] [Payments.charge Audit.record])))
(define retry-free [id total]
 (catch (checkout id total) error (succeed {:id "declined" :total 0})))
