(type Model {:count Int :status (Union :idle :loading :failed) :reason String})
(error CounterUnavailable {:reason String})
(service CounterStore (: get (-> (Effect Int [CounterUnavailable]))))
(: fetch-count (Effect Int [CounterUnavailable] [CounterStore.get]))
(define fetch-count (CounterStore.get))

(type Msg (Tagged (GotCount {:count Int}) (LoadFailed {:reason String})))
(: load-message (Effect Msg [] [CounterStore.get]))
(define load-message
  (catch (do! [n fetch-count] (GotCount {:count n}))
    (CounterUnavailable e)
    (LoadFailed {:reason e.reason})))
