(export format-alert severity-rank)

(define severity-rank [severity]
  (if (= severity "sev1")
    1
    (if (= severity "sev2")
      2
      3)))

(define format-alert [incident-id severity detail]
  (str "[" severity "] " incident-id ": " detail))
