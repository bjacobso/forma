(type IR {})
(form (sample {:keys [x]}) :types {:x String} :ir IR {})
(sample :x "ok" :x "again")
