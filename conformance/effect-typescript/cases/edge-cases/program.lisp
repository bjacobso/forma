;; Regressions from adversarial testing. Each definition once generated
;; TypeScript that failed to typecheck or computed the wrong answer:
;; double negation, template escaping, binders captured by builtins,
;; prototype keys, shadowing, literal widening, matches on primitives and
;; error unions, builtins passed as functions, constants that call
;; functions at load time, and provide inside a layer method.

(type Role (Union :admin :member))

(type Member {:name String
 :role Role})

(error NotFound {:key String})
(error Forbidden {:user String})

(service Store
  (: read (-> String (Effect String [NotFound Forbidden] [])))
  (: save (-> Member (Effect Unit [] []))))

(service Clock
  (: now (Effect Int [] [])))

(service Greeter
  (: greet (-> String (Effect String [] []))))

(: neg-neg (-> Int Int))
(define neg-neg  [x] (- (- x)))

(: neg-literal Int)
(define neg-literal (- -1))

(: answer Int)
(define answer (neg-neg 42))

(: price-tag (-> String String))
(define price-tag  [amount] (str "cost: $" "{amount} `" amount "`"))

(: reset-key (-> (Map String Int) String (Map String Int)))
(define reset-key  [counts key] (assoc (dissoc counts key) key 0))

(: lookup (-> (Map String Int) String (Option Int)))
(define lookup  [counts key] (get counts key))

(: rebound (-> Int Int))
(define rebound  [x] (let [x (+ x 1) x (* x 10)] x))

(: shout-all (-> (List String) (List String)))
(define shout-all  [names] (map upcase names))

(: status-text (-> Int String))
(define status-text  [code] (match code 200 "ok" 404 "missing" _ "other"))

(: yes-no (-> Bool String))
(define yes-no  [flag] (match flag true "yes" false "no"))

(: invite (-> String (Effect Member [] [Store.save])))
(define invite [name]
  (do! [member (succeed (Member {:name name :role "member"}))
        _ (Store.save member)]
    (succeed member)))

(: explain (-> String (Effect String [] [Store.read])))
(define explain [key]
  (catch (Store.read key)
    (_ error) (succeed (match error
                         (NotFound missing) (str "missing " (get missing :key))
                         (Forbidden denied) (str "denied " (get denied :user))))))

(: exclaim (-> String (Effect String [NotFound Forbidden] [Store.read])))
(define exclaim [key]
  (do! [value (Store.read key)
        value (succeed (str value "!"))]
    (succeed value)))

(: stamp (-> String (Effect String [] [Clock])))
(define stamp [name]
  (do! [time Clock.now]
    (succeed (str name "@" time))))

(layer ClockFixed :provides Clock
  (define now [] (succeed 7)))

(layer GreeterLive :provides Greeter
  (define greet [name] (provide (stamp name) ClockFixed)))

;; Second adversarial pass: literals in positions TypeScript does not type
;; from context, constants that reach other constants through functions,
;; and builtins used as values.

(type Shape (Tagged :tag kind (Circle {:radius Number}) (Square {:side Number})))

(: default-role (Effect Role [] []))
(define default-role (succeed "admin"))

(: circles (-> (List Number) (Effect (List Shape) [] [])))
(define circles [radii]
  (for-each radii (fn [r] (if (> r 1) (succeed {:kind "Circle" :radius r}) (succeed {:kind "Square" :side r})))))

(: pair (Effect (Tuple Shape Role) [] []))
(define pair (all [(succeed {:kind "Circle" :radius 1}) (succeed "member")]))

(: roles (-> (List Role)))
(define roles  [] (let [rs (: ["admin" "member"] (List Role))] rs))

(: by-name (-> (Map String Member) (Map String Member)))
(define by-name  [members] (let [next (assoc members "b" {:name "b" :role "member"})] next))

(: largest (-> (List Number) (Effect Shape [] [])))
(define largest [sizes]
  (stream-run-fold (stream-of sizes) (Shape {:kind "Square" :side 0}) (fn [acc size] {:kind "Circle" :radius size})))

(: lower-all (-> (List String) (List String)))
(define lower-all  [names] (let [f downcase] (map f names)))

(: scaled Int)
(define scaled (scale 3))

(: scale (-> Int Int))
(define scale  [x] (* x factor))

(: factor Int)
(define factor 2)
