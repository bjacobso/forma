; TS-engine-only Foldkit prototype: pure update / view, typed command recovery.
(type Model {:count Int :status (Union :idle :loading :failed) :reason String})
(error CounterUnavailable {:reason String})
(service CounterStore (: get (-> (Effect Int [CounterUnavailable]))))
(: fetch-count (Effect Int [CounterUnavailable] [CounterStore.get]))
(define fetch-count (CounterStore.get))

(msg Increment Decrement Load
  (GotCount {:count Int}) (LoadFailed {:reason String}))

(command load-count fetch-count
  :ok [n (GotCount {:count n})])

(update [model message]
  Increment (with (assoc model :count (+ model.count 1)))
  Decrement (with (assoc model :count (- model.count 1)))
  Load (with (assoc model :status :loading) :load-count)
  (GotCount {:count n}) (with (assoc (assoc model :count n) :status :idle))
  (LoadFailed {:reason reason}) (with (assoc (assoc model :status :failed) :reason reason)))

(view [model]
  [:div {:class "counter"}
    [:button {:on-click Decrement} "−"]
    [:span (str model.count)]
    [:button {:on-click Increment} "+"]
    [:button {:on-click Load} "Load"]
    [:span (str model.status " " model.reason)]])

(app Counter :model Model
  :init (with (Model {:count 0 :status :idle :reason ""})))
