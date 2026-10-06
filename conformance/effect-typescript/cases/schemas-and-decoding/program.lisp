;; Data modelling: brands, enums, tuples, unions, maps, annotated fields,
;; and a tagged union matched by tag. Untrusted JSON is decoded against the
;; schema before it is used.
(type ShapeId (Brand String))
(type Color (Union :red :green :blue))
(type Point (Tuple Number Number))
(type
  Shape
  (Tagged
    :tag
    kind
    (Circle {:radius Number})
    (Rectangle {:width Number :height Number})
    (Polygon {:points (List Point)})))
(type Label (Union String Int))
(type
  Drawing
  {
    :id ShapeId
    :shape Shape
    :color Color
    :label (Option Label)
    :tags (Map String String)
    :title (String :doc "Human readable title")})
(error InvalidDrawing {:message String})
(: make-circle (-> String Number Drawing))
(define
  make-circle
  [id radius]
  {
    :id (ShapeId id)
    :shape {:kind "Circle" :radius radius}
    :color "red"
    :tags {}
    :title (str "circle " id)})
(: area (-> Shape (Effect Number)))
(define
  area
  [shape]
  (match
    shape
    (Circle c)
    (succeed (* 3.14 (get c :radius) (get c :radius)))
    (Rectangle r)
    (succeed (* (get r :width) (get r :height)))
    (Polygon p)
    (succeed (count (get p :points)))))
(: warmth (-> Color (Effect String)))
(define warmth [color] (match color "red" (succeed "warm") _ (succeed "cool")))
(: parse-drawing (-> Json (Effect Drawing [InvalidDrawing] [])))
(define
  parse-drawing
  [input]
  (catch
    (decode Drawing input)
    (SchemaError _)
    (fail (InvalidDrawing {:message "drawing does not match the schema"}))))
(: describe-drawing (-> Json (Effect String [InvalidDrawing] [])))
(define
  describe-drawing
  [input]
  (do!
    [
      drawing
      (parse-drawing input)
      size
      (area (get drawing :shape))
      tone
      (warmth (get drawing :color))
      :let
      [label (get drawing :label)]]
    (succeed
      (str
        (get drawing :title)
        ": "
        tone
        " "
        (get (get drawing :shape) :kind)
        " of area "
        size
        " ["
        (get-or-else label "unlabelled")
        "]"))))
