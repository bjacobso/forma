(type ItemIR {:kind "Item" :id String :value String})
; This helper stays private.
(define label [value] value)
(form (item id value {:keys [doc]})
  "An item."
  :types {:id (Declares Item String) :value String :doc (Option String)}
  :ir ItemIR
  :examples [[(item "first" "value")]]
  {:kind "Item" :id id :value (label value)})
(export item ItemIR)
