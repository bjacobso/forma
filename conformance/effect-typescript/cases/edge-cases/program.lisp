;; Regressions from adversarial testing. Each definition once generated
;; TypeScript that failed to typecheck or computed the wrong answer:
;; double negation, template escaping, binders captured by builtins,
;; prototype keys, shadowing, literal widening, matches on primitives and
;; error unions, builtins passed as functions, constants that call
;; functions at load time, and provide inside a layer method.

(define-schema Role (Enum admin member))

(define-schema Member
  (Struct
    (field name String)
    (field role Role)))

(define-error NotFound (:fields (field key String)))
(define-error Forbidden (:fields (field user String)))

(define-service Store
  (:methods
    (read [key String] (Effect String [NotFound Forbidden] []))
    (save [member Member] (Effect Unit [] []))))

(define-service Clock
  (:methods
    (now [] (Effect Int [] []))))

(define-service Greeter
  (:methods
    (greet [name String] (Effect String [] []))))

(: neg-neg (-> Int Int))
(define neg-neg (fn [x] (- (- x))))

(: neg-literal Int)
(define neg-literal (- -1))

(: answer Int)
(define answer (neg-neg 42))

(: price-tag (-> String String))
(define price-tag (fn [amount] (str "cost: $" "{amount} `" amount "`")))

(: reset-key (-> (Map Int) String (Map Int)))
(define reset-key (fn [counts key] (assoc (dissoc counts key) key 0)))

(: lookup (-> (Map Int) String (Option Int)))
(define lookup (fn [counts key] (get counts key)))

(: rebound (-> Int Int))
(define rebound (fn [x] (let [x (+ x 1) x (* x 10)] x)))

(: shout-all (-> (Array String) (Array String)))
(define shout-all (fn [names] (map upcase names)))

(: status-text (-> Int String))
(define status-text (fn [code] (match code 200 "ok" 404 "missing" _ "other")))

(: yes-no (-> Bool String))
(define yes-no (fn [flag] (match flag true "yes" false "no")))

(: invite (-> String (Effect Member [] [Store.save])))
(define-operation invite [name]
  (do! [member (succeed (Member {:name name :role "member"}))
        _ (Store.save member)]
    (succeed member)))

(: explain (-> String (Effect String [] [Store.read])))
(define-operation explain [key]
  (catch (Store.read key)
    (_ error) (succeed (match error
                         (NotFound missing) (str "missing " (get missing :key))
                         (Forbidden denied) (str "denied " (get denied :user))))))

(: exclaim (-> String (Effect String [NotFound Forbidden] [Store.read])))
(define-operation exclaim [key]
  (do! [value (Store.read key)
        value (succeed (str value "!"))]
    (succeed value)))

(: stamp (-> String (Effect String [] [Clock])))
(define-operation stamp [name]
  (do! [time (Clock.now)]
    (succeed (str name "@" time))))

(define-layer ClockFixed
  (:provides Clock)
  (:methods
    (now [] (succeed 7))))

(define-layer GreeterLive
  (:provides Greeter)
  (:methods
    (greet [name] (provide (stamp name) ClockFixed))))

;; Second adversarial pass: literals in positions TypeScript does not type
;; from context, constants that reach other constants through functions,
;; and builtins used as values.

(define-schema Shape
  (TaggedUnion kind
    [circle (Struct (field radius Number))]
    [square (Struct (field side Number))]))

(: default-role (-> (Effect Role [] [])))
(define-operation default-role []
  (succeed "admin"))

(: circles (-> (Array Number) (Effect (Array Shape) [] [])))
(define-operation circles [radii]
  (for-each radii (fn [r] (if (> r 1) (succeed {:kind "circle" :radius r}) (succeed {:kind "square" :side r})))))

(: pair (-> (Effect (Tuple Shape Role) [] [])))
(define-operation pair []
  (all [(succeed {:kind "circle" :radius 1}) (succeed "member")]))

(: roles (-> (Array Role)))
(define roles (fn [] (let [rs (: ["admin" "member"] (Array Role))] rs)))

(: by-name (-> (Map Member) (Map Member)))
(define by-name (fn [members] (let [next (assoc members "b" {:name "b" :role "member"})] next)))

(: largest (-> (Array Number) (Effect Shape [] [])))
(define-operation largest [sizes]
  (stream-run-fold (stream-of sizes) (Shape {:kind "square" :side 0}) (fn [acc size] {:kind "circle" :radius size})))

(: lower-all (-> (Array String) (Array String)))
(define lower-all (fn [names] (let [f downcase] (map f names))))

(: scaled Int)
(define scaled (scale 3))

(: scale (-> Int Int))
(define scale (fn [x] (* x factor)))

(: factor Int)
(define factor 2)
