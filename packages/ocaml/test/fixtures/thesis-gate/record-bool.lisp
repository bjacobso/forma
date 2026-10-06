(entity Employee {:active (Option Bool)
    :name (Option String)})

(seed Employee "emp:active" {:active true
  :name "Alice"})
