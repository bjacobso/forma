(export Mode State)
(type Mode (Union :standard :express))
(type Parcel {:grams Int :mode Mode :destination (Option String)})
(type State (Tagged (Ready {:cost Int}) (Blocked {:reason String})))
