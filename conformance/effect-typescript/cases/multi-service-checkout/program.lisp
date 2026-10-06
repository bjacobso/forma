;; A checkout application wired from several services. Forma implements the
;; catalog, the notifier, and the checkout workflow as layers; the harness
;; supplies the clock, inventory, and payment adapters.
(type Sku (Brand String))
(type OrderLine {:sku Sku :quantity Int})
(type OrderRequest {:customer String :lines (List OrderLine)})
(type Receipt {:charge-id String :total-cents Int :placed-at Int})
(error OutOfStock {:sku Sku})
(error PaymentDeclined {:reason String})
(error InvalidOrder {:reason String})
(service Clock (: now (Effect Int)))
(service Catalog (: price (-> Sku (Effect (Option Int)))))
(service
  Inventory
  (: reserve (-> Sku Int (Effect Unit [OutOfStock] [])))
  (: release (-> Sku Int (Effect Unit))))
(service
  Payments
  (: charge (-> String Int (Effect String [PaymentDeclined] []))))
(service Notifier (: send (-> String String (Effect Unit))))
(service
  Checkout
  (:
    place
    (->
      OrderRequest
      (Effect Receipt [InvalidOrder OutOfStock PaymentDeclined] []))))
(: line-total (-> OrderLine Int Int))
(define line-total [line unit-cents] (* (get line :quantity) unit-cents))
(:
  price-lines
  (-> (List OrderLine) (Effect Int [InvalidOrder] [Catalog.price])))
(define
  price-lines
  [lines]
  (do!
    [
      totals
      (for-each
        lines
        (fn
          [line]
          (do!
            [price (Catalog.price (get line :sku))]
            (match
              price
              (Some cents)
              (succeed (line-total line cents))
              None
              (fail
                (InvalidOrder {:reason (str "unknown sku " (get line :sku))}))))))]
    (succeed (sum totals))))
(:
  reserve-all
  (-> (List OrderLine) (Effect Unit [OutOfStock] [Inventory.reserve])))
(define
  reserve-all
  [lines]
  (do!
    [
      _
      (for-each
        lines
        (fn [line] (Inventory.reserve (get line :sku) (get line :quantity))))]
    (succeed nil)))
(: release-all (-> (List OrderLine) (Effect Unit [] [Inventory.release])))
(define
  release-all
  [lines]
  (do!
    [
      _
      (for-each
        lines
        (fn [line] (Inventory.release (get line :sku) (get line :quantity))))]
    (succeed nil)))
(: price-list (Map String Int))
(define price-list {"apple" 120 "pear" 90 "fig" 300})
(layer
  CatalogStatic
  :provides
  Catalog
  (define price [sku] (succeed (get price-list sku))))
(layer
  NotifierLog
  :provides
  Notifier
  (define send [customer message] (log "notify" customer message)))
(layer
  CheckoutLive
  :provides
  Checkout
  (define
    place
    [request]
    (do!
      [
        _
        (when
          (empty? (get request :lines))
          (fail (InvalidOrder {:reason "an order needs at least one line"})))
        total
        (price-lines (get request :lines))
        _
        (reserve-all (get request :lines))
        charge-id
        (catch
          (Payments.charge (get request :customer) total)
          (PaymentDeclined declined)
          (do! [_ (release-all (get request :lines))] (fail declined)))
        placed-at
        Clock.now
        _
        (Notifier.send (get request :customer) (str "charged " total " cents"))]
      (succeed {:charge-id charge-id :total-cents total :placed-at placed-at}))))
(: AppLive (Layer [Checkout] [] [Clock Inventory Payments]))
(layer
  AppLive
  (layer-provide CheckoutLive (layer-merge CatalogStatic NotifierLog)))
(:
  place-order
  (->
    OrderRequest
    (Effect
      Receipt
      [InvalidOrder OutOfStock PaymentDeclined]
      [Clock Inventory Payments])))
(define place-order [request] (provide (Checkout.place request) AppLive))
