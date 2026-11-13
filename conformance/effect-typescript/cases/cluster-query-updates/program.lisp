; Queries run concurrently with commands, so they cannot update state.
(entity Counter
  :state {:count Int}
  :initial {:count 0}
  :storage :memory
  (query Count :success Int
    :update {:count (+ state.count 1)}
    :reply state.count))
