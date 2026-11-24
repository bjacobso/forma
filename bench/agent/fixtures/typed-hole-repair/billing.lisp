(import "./types.lisp" [Tier Invoice Summary])
(export net-amount tier-surcharge format-label summarize)

(: clamp-nonneg (-> Int Int))
(defn clamp-nonneg [n] (if (< n 0) 0 n))

(: net-amount (-> Invoice Int))
(define net-amount [inv]
  (let [subtotal inv.subtotal
        discount (clamp-nonneg (get inv :discont))
        raw (- subtotl discount)]
    ?net))

(: tier-surcharge (-> Tier Int Int))
(define tier-surcharge [tier net]
  (match tier
    :standard 0
    :priority ?priority-fee))

(: format-label (-> (Option String) String))
(define format-label [note]
  (match note
    (Some text) ?some-label
    None "unlabeled"))

(: summarize (-> Invoice Summary))
(define summarize [inv]
  (let [net (net-amount inv)
        surcharge (tier-surcharge inv.tier net)]
    {:id inv.id :net net :surcharge surcharge :total ?grand-total :label (format-label inv.note)}))
