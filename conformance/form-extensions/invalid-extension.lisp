(type LabelIR {:text String})
(form (label text)
  :extensions {:catalog/label {:computed (str "not constant")}}
  :types {:text String}
  :ir LabelIR
  {:text text})
