;; A checkout application wired from several services. Forma implements the
;; catalog, the notifier, and the checkout workflow as layers; the harness
;; supplies the clock, inventory, and payment adapters.

(define-schema Sku (Brand Sku String))

(define-schema OrderLine
  (Struct
    (field sku Sku)
    (field quantity Int)))

(define-schema OrderRequest
  (Struct
    (field customer String)
    (field lines (Array OrderLine))))

(define-schema Receipt
  (Struct
    (field charge-id String)
    (field total-cents Int)
    (field placed-at Int)))

(define-error OutOfStock (:fields (field sku Sku)))
(define-error PaymentDeclined (:fields (field reason String)))
(define-error InvalidOrder (:fields (field reason String)))

(define-service Clock
  (:methods
    (now [] (Effect Int [] []))))

(define-service Catalog
  (:methods
    (price [sku Sku] (Effect (Option Int) [] []))))

(define-service Inventory
  (:methods
    (reserve [sku Sku quantity Int] (Effect Unit [OutOfStock] []))
    (release [sku Sku quantity Int] (Effect Unit [] []))))

(define-service Payments
  (:methods
    (charge [customer String amount-cents Int] (Effect String [PaymentDeclined] []))))

(define-service Notifier
  (:methods
    (send [customer String message String] (Effect Unit [] []))))

(define-service Checkout
  (:methods
    (place [request OrderRequest]
      (Effect Receipt [InvalidOrder OutOfStock PaymentDeclined] []))))

(: line-total (-> OrderLine Int Int))
(define line-total
  (fn [line unit-cents] (* (get line :quantity) unit-cents)))

(: price-lines (-> (Array OrderLine) (Effect Int [InvalidOrder] [Catalog.price])))
(define-operation price-lines [lines]
  (do! [totals (for-each lines
                 (fn [line]
                   (do! [price (Catalog.price (get line :sku))]
                     (match price
                       (some cents) (succeed (line-total line cents))
                       none (fail (InvalidOrder {:reason (str "unknown sku " (get line :sku))}))))))]
    (succeed (sum totals))))

(: reserve-all (-> (Array OrderLine) (Effect Unit [OutOfStock] [Inventory.reserve])))
(define-operation reserve-all [lines]
  (do! [_ (for-each lines (fn [line] (Inventory.reserve (get line :sku) (get line :quantity))))]
    (succeed nil)))

(: release-all (-> (Array OrderLine) (Effect Unit [] [Inventory.release])))
(define-operation release-all [lines]
  (do! [_ (for-each lines (fn [line] (Inventory.release (get line :sku) (get line :quantity))))]
    (succeed nil)))

(: price-list (Map Int))
(define price-list {"apple" 120 "pear" 90 "fig" 300})

(define-layer CatalogStatic
  (:provides Catalog)
  (:methods
    (price [sku] (succeed (get price-list sku)))))

(define-layer NotifierLog
  (:provides Notifier)
  (:methods
    (send [customer message]
      (log "notify" customer message))))

(define-layer CheckoutLive
  (:provides Checkout)
  (:methods
    (place [request]
      (do! [_ (when (empty? (get request :lines))
                (fail (InvalidOrder {:reason "an order needs at least one line"})))
            total (price-lines (get request :lines))
            _ (reserve-all (get request :lines))
            charge-id (catch (Payments.charge (get request :customer) total)
                        (PaymentDeclined declined)
                          (do! [_ (release-all (get request :lines))]
                            (fail declined)))
            placed-at (Clock.now)
            _ (Notifier.send (get request :customer) (str "charged " total " cents"))]
        (succeed {:charge-id charge-id :total-cents total :placed-at placed-at})))))

(: AppLive (Layer [Checkout] [] [Clock Inventory Payments]))
(define-layer AppLive
  (layer-provide CheckoutLive (layer-merge CatalogStatic NotifierLog)))

(: place-order (-> OrderRequest
                   (Effect Receipt [InvalidOrder OutOfStock PaymentDeclined] [Clock Inventory Payments])))
(define-operation place-order [request]
  (provide (Checkout.place request) AppLive))
