(import "./m.lisp" [f g k])
(export thing ThingIR)
(type ThingIR {:kind "Thing" :name Symbol})
(form (thing name)
  "x"
  :types {:name (Declares ThingDecl)}
  :ir ThingIR
  :check (fn [h] (if (= (k 1) 2) [] [{:severity :error :code "t" :message "wrong" :slot :name}]))
  {:kind "Thing" :name name})
