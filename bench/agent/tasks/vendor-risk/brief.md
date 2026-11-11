# Vendor risk review

Vendor risk review for a 200-person SaaS company:

1. Every vendor that touches customer data needs a security review before contract signature: a completed security questionnaire and either a current SOC 2 Type II report or an approved exception.
2. Reviews expire after 12 months and must be redone.
3. High-risk vendors (those processing customer personal data) also need a data processing agreement on file.
4. Exceptions are approved only by the CISO, must give a reason, and expire after 6 months.
5. Procurement must not mark a vendor active while its review is incomplete or expired.

Synthetic data only. This is illustrative, not compliance advice.

## Deliverables
Write `policy.lisp`, exporting Role, Exception, Review, Vendor, activation-blockers,
can-activate?, can-sign-contract?, exception-valid?, security-review-complete?.
Use the following public records (field spellings are the API):
- Role: union :ciso :security-analyst :procurement :vendor-manager.
- Exception: approved-by Role, reason String, approved-on Int.
- Review: completed-on Int, questionnaire-complete Bool,
  soc2-type2-issued-on (Option Int), exception (Option Exception).
- Vendor: name String, touches-customer-data Bool,
  processes-customer-personal-data Bool, dpa-on-file Bool, review (Option Review).
Functions take Vendor then today Int, except exception-valid? takes Exception then today.
activation-blockers returns a List String; the other functions return Bool.
Use Int day numbers: 12 months = 365 days, 6 months = 182. Future dates are invalid;
expiry is exclusive. Whitespace-only reasons are invalid. Personal data implies
customer data. A vendor touching neither kind needs no review. Blocker order and
text: "no security review on file", "security review expired or not yet valid",
"security questionnaire incomplete", "no current SOC 2 Type II report and no valid CISO exception",
"high-risk vendor has no data processing agreement". Only report review-specific
blockers when a review exists. security-review-complete? checks review only.

Write `register-forms.lisp` exporting vendor and its IR types. Syntax:
(vendor name :status "active" :as-of 1000 :touches-customer-data true
 :processes-customer-personal-data false :dpa-on-file false :reviewed-on 900
 :questionnaire-complete true :soc2-issued-on 800 :exception-by ""
 :exception-reason "" :exception-on -1)
All options are required. -1 dates and empty approver mean not on file.
Statuses: proposed, active, offboarded; approvers use role names without colons or "".
Project {kind "Vendor", name Symbol, status String, as-of Int, blockers (List String)}.
A :check must reject active vendors with blockers using vendor/active-without-review.
Write `main.lisp` importing vendor and declaring one valid active vendor and one
proposed vendor with blockers. Hidden tests exercise policy boundaries and register errors.

Write your solution in the sandbox root. Use only `.lisp` for authored source.
`bin/forma` is also on PATH. Commands print JSON and exit nonzero on errors:

```sh
forma file typecheck main.lisp
forma file evaluate main.lisp
forma file declarations main.lisp   # elaborate forms and inspect FormApplication payloads
```

Read the supplied docs as needed. Existing library paths retain their repository
extensions. Do not edit supplied context. Hidden tests import your exports and
exercise additional inputs. No network or new dependencies are needed.
