(export Sample Stats aggregate moving)
(type Sample {:elapsed Float :units Int})
(type Stats {:elapsed Float :units Int :rate Float})
(: add-units (-> Int Sample Int))
(define add-units [a s] (+ a s.units))
(: aggregate (-> (List Sample) Stats))
(define aggregate [samples]
 (let [elapsed (reduce (fn [a s] (+ a s.elapsed)) 0.0 samples)
       units (reduce add-units 0 samples)]
  {:elapsed elapsed :units units :rate (if (= elapsed 0.0) 0.0 (/ (* units 1.0) elapsed))}))
(type Smooth {:previous Float :values (List Float)})
(: smooth (-> Smooth Float Smooth))
(define smooth [state x]
 (let [next (+ (* 0.25 x) (* 0.75 state.previous))]
  {:previous next :values (conj state.values next)}))
(: moving (-> Float (List Float) (List Float)))
(define moving [initial samples]
 (get (reduce smooth {:previous initial :values []} samples) :values))
