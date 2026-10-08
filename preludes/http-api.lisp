; Effect 4 HttpApi vocabulary. Emit hooks return quasiquoted TypeScript
; expressions; ts/* are target primitives, not HTTP-specific compiler cases.
(type HttpEndpointIR
  {:kind "HttpEndpoint" :name Symbol :method Keyword :path String
   :params (Option Type) :payload (Option Type) :success Type
   :errors (Option (List Type))})
(type HttpGroupIR {:kind "HttpGroup" :name Symbol :endpoints (List HttpEndpointIR)})
(type HttpApiIR {:kind "HttpApi" :name Symbol :groups (List HttpGroupIR)})
(type HttpHandlerIR {:kind "HttpHandler" :endpoint Symbol :operation Symbol})
(type HttpHandleIR
  {:kind "HttpHandle" :api Symbol :group Symbol :handlers (List HttpHandlerIR)})

(form (endpoint name method path {:keys [params payload success errors]})
  "An HTTP endpoint with checked request and response schemas."
  :types {:name (Declares EndpointDecl)
          :method (Union :get :post :put :patch :delete)
          :path String :params (Option Type) :payload (Option Type)
          :success Type :errors (Option (List Type))}
  :ir HttpEndpointIR
  :emit (fn [ir]
    (let [options {:success (ts/schema (get ir :success))
                   :error (ts/schemas (get ir :errors))}
          options (if (get ir :params)
                    (assoc options :params (ts/schema (get ir :params))) options)
          options (if (get ir :payload)
                    (assoc options :payload (ts/schema (get ir :payload))) options)]
      `(~(ts/ref (str "HttpApiEndpoint." (keyword/name (get ir :method))))
         ~(get ir :name) ~(get ir :path) ~options)))
  {:kind "HttpEndpoint" :name name :method method :path path
   :params params :payload payload :success success :errors errors})

(form (group name endpoint ...)
  :types {:name (Declares GroupDecl) :endpoint (List endpoint)}
  :ir HttpGroupIR
  :emit (fn [ir]
    `(ts/method (HttpApiGroup.make ~(get ir :name)) "add"
       ~@(ts/children (get ir :endpoints))))
  {:kind "HttpGroup" :name name :endpoints endpoint})

(form (api name group ...)
  :types {:name (Declares ApiDecl) :group (List group)}
  :ir HttpApiIR
  :emit (fn [ir]
    `(ts/method (HttpApi.make ~(get ir :name)) "add"
       ~@(ts/children (get ir :groups))))
  {:kind "HttpApi" :name name :groups group})

; Handlers reuse ordinary checked Forma operations. The linker checks each
; operation against the endpoint's success, request, and closed error set.
(form (handler endpoint operation)
  :types {:endpoint Symbol :operation Symbol}
  :ir HttpHandlerIR
  :emit (fn [ir]
    `(ts/method handlers "handle" ~(get ir :endpoint) ~(ts/operation (get ir :operation))))
  {:kind "HttpHandler" :endpoint endpoint :operation operation})

(form (handle api group handler ...)
  :types {:api (Refers ApiDecl) :group Symbol :handler (List handler)}
  :ir HttpHandleIR
  :emit (fn [ir]
    `(HttpApiBuilder.group ~(ts/declaration (get ir :api)) ~(get ir :group)
       (ts/arrow [handlers] ~(ts/chain "handlers" (ts/children (get ir :handlers))))))
  {:kind "HttpHandle" :api api :group group :handlers handler})
