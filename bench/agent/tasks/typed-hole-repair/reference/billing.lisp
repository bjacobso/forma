(import "./types.lisp" [Tier Invoice Summary])
(export net-amount tier-surcharge format-label summarize)

(: clamp-nonneg (-> Int Int))
(define clamp-nonneg [n] (if (< n 0) 0 n))

(: net-amount (-> Invoice Int))
(define net-amount [inv]
  (let [subtotal inv.subtotal
        discount (clamp-nonneg (get inv :discount))
        raw (- subtotal discount)]
    (clamp-nonneg raw)))

(: tier-surcharge (-> Tier Int Int))
(define tier-surcharge [tier net]
  (match tier
    :standard 0
    :priority (if (<= net 0) 0 (+ 250 (quot net 10)))))

(: format-label (-> (Option String) String))
(define format-label [note]
  (match note
    (Some text) (let [cleaned (trim text)] (if (= cleaned "") "unlabeled" cleaned))
    None "unlabeled"))

(: summarize (-> Invoice Summary))
(define summarize [inv]
  (let [net (net-amount inv)
        surcharge (tier-surcharge inv.tier net)]
    {:id inv.id :net net :surcharge surcharge :total (+ net surcharge) :label (format-label inv.note)}))
