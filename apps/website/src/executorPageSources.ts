/** Authored examples for /executor; snippets are regenerated from real compiler results. */

/** What the host puts in scope: one service per integration, one member per tool. Hand-written here. */
export const catalogSource = `; Tool catalog: one service per integration, one member per tool.
(type Issue {:number Int :title String :idle-days Int})
(error RateLimited {:retry-after Int})
(service GitHub
  (: list-issues
     (-> {:repo String :state (Union :open :closed)}
         (Effect (List Issue) [RateLimited])))
  (: close-issue (-> {:repo String :number Int} (Effect Unit))))
(service Slack
  (: post-message
     (-> {:channel String :text String} (Effect {:ts String}))))`;

/** What the agent submits. The signature of main is its manifest. */
export const turnSource = `(: stale? (-> Issue Bool))
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
                      :text (join (map line stale) "\\n")})]
        (str (count stale) " stale issues posted at " posted.ts)))))`;

/** The checker sees one module: the catalog followed by the turn. */
export const programSource = `${catalogSource}\n\n${turnSource}`;

function edit(source: string, from: string, to: string): string {
  if (!source.includes(from)) throw new Error(`Missing edit target: ${from}`);
  return source.replace(from, to);
}

/** The first draft: a value outside the tool's input type, and an unhandled tool failure. */
export const turnDraftSource = edit(edit(turnSource, ":state :open", ":state :stale"),
  `  (catch (GitHub.list-issues {:repo "acme/api" :state :stale})
    (RateLimited _) (succeed [])))`,
  `  (GitHub.list-issues {:repo "acme/api" :state :stale}))`);
/** A program that does more than its manifest admits. */
export const turnCloseIssueSource = edit(turnSource,
  "      (do! [posted",
  `      (do! [_ (for-each stale
                (fn [i] (GitHub.close-issue {:repo "acme/api" :number i.number})))
            posted`);

/** The live embed checks the whole module; introducing the error adds the undeclared tool call. */
export const executorLiveSource = programSource;
export const executorLiveBrokenSource = `${catalogSource}\n\n${turnCloseIssueSource}`;
