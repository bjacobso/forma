; No commands or services; transition values in let / if; a static view.
(type Model {:count Int})
(msg Bump Reset)
(update [state event]
  Bump
  (let [next (with (assoc state :count (+ state.count 1)))] next)
  Reset
  (if (= state.count 0) (with state) (with (Model {:count 0}))))
(view [elm-view-0] [:div])
(app PureCounter :model Model :init (with (Model {:count 0})))
