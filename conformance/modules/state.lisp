(export Status label)
(type Status (Tagged (Ready {:message String}) Empty))
(: label (-> Status String))
(define label [status]
  (match status
    (Status.Ready {:message message}) message
    Status.Empty ""))
