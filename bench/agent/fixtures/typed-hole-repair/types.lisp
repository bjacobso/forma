(export Tier Invoice Summary)
(type Tier (Union :standard :priority))
(type Invoice {:id String :subtotal Int :discount Int :tier Tier :note (Option String)})
(type Summary {:id String :net Int :surcharge Int :total Int :label String})
