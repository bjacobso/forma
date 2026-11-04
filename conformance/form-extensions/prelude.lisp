; Two unrelated namespaces use the same form-local constant metadata option.
(type LabelDef Symbol)
(type ReleaseDef Symbol)
(type LabelIR {:kind "Label" :name Symbol :props Json})
(type ReleaseIR {:kind "Release" :name Symbol :version String})

(form (label name text {:keys [enabled note]})
  "Declares a copy label with string-keyed configuration."
  :extensions
    {:catalog/label {:category :copy :fallback nil :flags [true false]
                     :details {"rank" 2}}}
  :types {:name (Declares LabelDef) :text String :enabled Bool
          :note (Option String)}
  :ir LabelIR
  {:kind "Label" :name name :props (named-map text enabled note)})

(form (release name version)
  "Declares a build release with tooling metadata."
  :extensions {:build/release {:channel :stable :targets ["browser" "node"]}}
  :types {:name (Declares ReleaseDef) :version String}
  :ir ReleaseIR
  {:kind "Release" :name name :version version})
