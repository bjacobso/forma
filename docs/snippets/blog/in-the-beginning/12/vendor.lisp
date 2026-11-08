(defform (review (owner Name) (vendor Name))
  (doc Ask owner to approve vendor.)
  `(ask ',owner ',vendor))

(defform (vendor (name Name) (limit Num) (owner Name))
  (doc Have owner review name when its risk is over limit.)
  `(when (< ,limit (risk ',name))
     (review ,owner ,name)))
