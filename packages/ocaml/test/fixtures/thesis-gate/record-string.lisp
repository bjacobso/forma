(entity Employee {:active (Option Bool)
    :name (Option String)})

(seed Employee "emp:active" {:active "yes"
  :name "Alice"})
