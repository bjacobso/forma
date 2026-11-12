(import "./types.lisp" [Step Plan])
(export cost order problems)
(: includes? (-> (List String) String Bool))
(define includes? [xs x] (> (count (filter (fn [y] (= x y)) xs)) 0))
(: duplicate? (-> (List String) Bool))
(define duplicate? [xs]
 (if (empty? xs) false (if (includes? (rest xs) (first xs)) true (duplicate? (rest xs)))))
(: add-cost (-> Int Step Int))
(define add-cost [a s] (+ a (* s.timeout s.attempts)))
(: cost (-> Plan Int))
(define cost [p] (reduce add-cost 0 p.steps))
(: ready? (-> (List String) Step Bool))
(define ready? [done s] (empty? (filter (fn [d] (if (includes? done d) false true)) s.depends)))
(: schedule (-> (List Step) (List String) Int (List String)))
(define schedule [remaining done fuel]
 (if (<= fuel 0) done
  (let [ready (filter (fn [s] (ready? done s)) remaining)]
   (if (empty? ready) done
    (let [id (get (first ready) :id)]
     (schedule (filter (fn [s] (if (= s.id id) false true)) remaining) (conj done id) (- fuel 1)))))))
(: order (-> Plan (List String)))
(define order [p] (schedule p.steps [] (count p.steps)))
(: invalid-deps? (-> (List String) Step Bool))
(define invalid-deps? [ids s]
 (if (duplicate? s.depends) true
  (if (includes? s.depends s.id) true
   (> (count (filter (fn [d] (if (includes? ids d) false true)) s.depends)) 0))))
(: invalid-settings? (-> Step Bool))
(define invalid-settings? [s]
 (if (<= s.timeout 0) true (if (<= s.attempts 0) true (if s.manual (if (= s.attempts 1) false true) false))))
(type Check {:bad Bool :category String})
(: problems (-> Plan (List String)))
(define problems [p]
 (let [ids (map (fn [s] s.id) p.steps)]
  (map (fn [c] c.category)
   (filter (fn [c] c.bad)
    [{:bad (if (duplicate? ids) true (> (count (filter (fn [id] (= (trim id) "")) ids)) 0)) :category "ids"}
     {:bad (> (count (filter (fn [s] (invalid-deps? ids s)) p.steps)) 0) :category "dependencies"}
     {:bad (> (count (filter invalid-settings? p.steps)) 0) :category "settings"}
     {:bad (if (< p.budget 0) true (> (cost p) p.budget)) :category "budget"}
     {:bad (< (count (order p)) (count p.steps)) :category "cycle"}]))))
