; Tool catalog: one service per integration, one member per tool.
(type Issue {:number Int :title String :idle-days Int})
(error RateLimited {:retry-after Int})
(service GitHub
  (: list-issues
     (-> {:repo String :state (Union :open :closed)}
         (Effect (List Issue) [RateLimited])))
  (: close-issue (-> {:repo String :number Int} (Effect Unit))))
(service Slack
  (: post-message
     (-> {:channel String :text String} (Effect {:ts String}))))
