;; Schemas describe data; errors describe typed failures.
(type AskBody {:question String})
(type MarketSnapshot {:symbol String :changePct Number})
(type MarketBrief {:headline String :changePct Number :summary String})
(error MarketApiError {:message String})

;; Host adapters supply HTTP access and structured model output.
(service MarketHttp
  (: snapshot (Effect MarketSnapshot [MarketApiError])))
(service LanguageModel
  (: generate (-> String MarketSnapshot (Effect MarketBrief [MarketApiError]))))

;; Services are interfaces. Layers implement and wire them.
(service MarketFeed
  (: snapshot (Effect MarketSnapshot [MarketApiError])))
(layer MarketFeedLive :provides MarketFeed
  (define snapshot [] MarketHttp.snapshot))

(service MarketDesk
  (: brief (-> String (Effect MarketBrief [MarketApiError]))))
(layer MarketDeskLive :provides MarketDesk
  (define brief [question]
    (do! [snapshot MarketFeed.snapshot
          brief (LanguageModel.generate question snapshot)]
      (succeed brief))))

;; Hide MarketFeed; leave the HTTP and model adapters to the host.
(: AppLive (Layer [MarketDesk] [] [MarketHttp LanguageModel]))
(layer AppLive (layer-provide MarketDeskLive MarketFeedLive))

;; The HTTP handler delegates to this checked operation.
(: ask-market (-> AskBody (Effect MarketBrief [MarketApiError] [MarketHttp LanguageModel])))
(define ask-market [payload]
  (provide (MarketDesk.brief (get payload :question)) AppLive))
