;; Data modelling: brands, enums, tuples, unions, maps, annotated fields,
;; and a tagged union matched by tag. Untrusted JSON is decoded against the
;; schema before it is used.

(define-schema ShapeId (Brand ShapeId String))

(define-schema Color (Enum red green blue))

(define-schema Point (Tuple Number Number))

(define-schema Shape
  (TaggedUnion kind
    [circle (Struct (field radius Number))]
    [rectangle (Struct (field width Number) (field height Number))]
    [polygon (Struct (field points (Array Point)))]))

(define-schema Label (Union String Int))

(define-schema Drawing
  (Struct
    (field id ShapeId)
    (field shape Shape)
    (field color Color)
    (field label (Optional Label))
    (field tags (Map String))
    (field title (String :doc "Human readable title"))))

(define-error InvalidDrawing (:fields (field message String)))

(: make-circle (-> String Number Drawing))
(define make-circle
  (fn [id radius]
    {:id (ShapeId id)
     :shape {:kind "circle" :radius radius}
     :color "red"
     :tags {}
     :title (str "circle " id)}))

(: area (-> Shape (Effect Number [] [])))
(define-operation area [shape]
  (match shape
    (circle c) (succeed (* 3.14 (get c :radius) (get c :radius)))
    (rectangle r) (succeed (* (get r :width) (get r :height)))
    (polygon p) (succeed (count (get p :points)))))

(: warmth (-> Color (Effect String [] [])))
(define-operation warmth [color]
  (match color
    "red" (succeed "warm")
    _ (succeed "cool")))

(: parse-drawing (-> Json (Effect Drawing [InvalidDrawing] [])))
(define-operation parse-drawing [input]
  (catch (decode Drawing input)
    (SchemaError _) (fail (InvalidDrawing {:message "drawing does not match the schema"}))))

(: describe-drawing (-> Json (Effect String [InvalidDrawing] [])))
(define-operation describe-drawing [input]
  (do! [drawing (parse-drawing input)
        size (area (get drawing :shape))
        tone (warmth (get drawing :color))
        label (succeed (get drawing :label))]
    (succeed (str (get drawing :title) ": " tone " " (get (get drawing :shape) :kind)
                  " of area " size
                  " [" (get-or-else label "unlabelled") "]"))))
