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
      (do! [posted (Slack.post-message
                     {:channel "#eng"
                      :text (join (map line stale) "\n")})]
        (str (count stale) " stale issues posted at " posted.ts)))))
