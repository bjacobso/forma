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

(: stale? (-> Issue Bool))
(define stale? [issue] (> issue.idle-days 14))

(: line (-> Issue String))
(define line [issue] (str "#" issue.number " " issue.title))

(: open-issues (Effect (List Issue) [] [GitHub.list-issues]))
(define open-issues
  (catch (GitHub.list-issues {:repo "acme/api" :state :open})
    (RateLimited _) (succeed [])))

(: main (Effect String [] [GitHub.list-issues Slack.post-message]))
(define main
  (do! [issues open-issues
        :let [stale (filter stale? issues)]]
    (if (empty? stale)
      (succeed "Nothing stale.")
      (do! [_ (for-each stale
                (fn [i] (GitHub.close-issue {:repo "acme/api" :number i.number})))
            posted (Slack.post-message
                     {:channel "#eng"
                      :text (join (map line stale) "\n")})]
        (str (count stale) " stale issues posted at " posted.ts)))))
