(import "./model.lisp" [Address Contact Member])
(export label credit reachable? reconcile)
(: city-label (-> Address String))
(define city-label [a]
 (let [city (trim a.city)]
  (if (= city "") ""
   (match a.unit (Some u) (if (= (trim u) "") city (str city " / " (trim u))) None city))))
(: contact-label (-> Contact String))
(define contact-label [c]
 (let [email (match c.email (Some e) (trim e) None "")]
  (if (= email "") (match c.address (Some a) (city-label a) None "") email)))
(: label (-> Member String))
(define label [m]
 (let [found (match m.contact (Some c) (contact-label c) None "")]
  (if (= found "") m.name found)))
(: credit (-> Member Int))
(define credit [m] (match m.credits (Some n) (if (< n 0) 0 n) None 0))
(: reachable? (-> Member Bool))
(define reachable? [m]
 (match m.contact (Some c) (if (= (contact-label c) "") false true) None false))
(: add-credit (-> Int Member Int))
(define add-credit [a m] (+ a (credit m)))
(: reconcile (-> (List Member) {:labels (List String) :credits Int :reachable Int}))
(define reconcile [members]
 {:labels (map label members)
  :credits (reduce add-credit 0 members)
  :reachable (count (filter reachable? members))})
