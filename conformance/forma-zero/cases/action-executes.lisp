; layers 2+4 — execute is an assertion: an admitted invocation fact
; triggers the action's reaction, whose emission lands in the log
(let
  [
    log
    (concat [(grant "root" "invoke") (grant "system" "sent")] [])
    send-welcome
    (make-action "send-welcome"
      (fn [f fs] (concat [[(nth f 0) "sent" "welcome-email"]] [])))
    final
    (opeval log
      (concat [{:fact ["ben" "invoke" "send-welcome"] :by "root"}] [])
      (concat [send-welcome] []))]
  (member? final ["ben" "sent" "welcome-email"]))
