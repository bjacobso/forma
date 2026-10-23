/**
 * Programs shown on the docs `/email` page and its live workbench. The page
 * imports these sources and their real compiler output from
 * `docs/snippets/email`; see `emailPageSnippets.ts`.
 */

/** The executed `email-warmup` conformance program. */
export const warmupSource = `; warm-up email 3: who gets it, when, and how fast
(rule "launch-warmup-3"
  (lanes
    (lane "gmail"   :per-hour 2000)
    (lane "default" :per-hour 16000))
  (when (due? "value-path" 6h) (defer 6h))
  (when (tag? "customer") (skip "already bought"))
  (when (domain? "gmail.com") (send "gmail"))
  (send "default"))

(error RateLimited {:retry-in-hours Int})
(error Bounced {:reason String})
(service Mailer
  (: deliver (-> EmailLane String (Effect Unit [RateLimited Bounced]))))

(: run-warmup (-> EmailContact (Effect EmailDecision [] [Mailer.deliver])))
(define run-warmup [contact]
  (let [decision (launch-warmup-3 contact)]
    (match decision
      (EmailDecision.Send s)
        (catch (do! [_ (Mailer.deliver s.lane contact.email)] decision)
          (RateLimited e) (defer e.retry-in-hours)
          (Bounced e) (skip e.reason))
      (EmailDecision.Defer d) decision
      (EmailDecision.Skip s) decision)))`;

/** Gmail recipients routed to a lane that was never declared. */
export const warmupLaneTypoSource = warmupSource.replace('(send "gmail"))', '(send "gmial"))');

/** A rule whose last clause is conditional, so some contacts get no decision. */
export const warmupFallthroughSource = warmupSource.replace('\n  (send "default"))', ")");

/** Delivery without a recovery for bounced addresses. */
export const warmupUnhandledBounceSource = warmupSource.replace("\n          (Bounced e) (skip e.reason)", "");

/** Delivery that forgets what to do with skipped contacts. */
export const warmupMissingArmSource = warmupSource.replace("\n      (EmailDecision.Skip s) decision", "");
