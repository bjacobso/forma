# A multi-module procurement language
Write five modules: `types.lisp`, `calendar.lisp`, `policy.lisp`, `forms.lisp`,
`main.lisp`. types exports Role = (Union "manager" "finance" "ciso"),
Facts {:amount Int :role Role :approved-on Int :as-of Int :reason String},
Decision {:allowed Bool :due Int :reason String}.
calendar exports current? : Int -> Int -> Bool, true iff approved-on <= as-of
< approved-on+182, and due : Int -> Int (add 182).
policy exports decide : Facts -> Decision. Precedence: amount<0 => "negative";
blank trimmed reason => "reason"; invalid date window => "expired";
amount>250000 and role not finance => "finance"; otherwise "ok".
due is always approved-on+182; allowed iff reason="ok". Zero is valid.
forms imports policy/calendar and defines (approval name :amount Int :role Role
:approved-on Int :as-of Int :reason String :status Status) where Status is a
closed union "draft"/"active". Export approval, Status and ApprovalIR:
{:kind "Approval" :name Symbol :status Status :allowed Bool :due Int :reason String}.
Project decide's fields. :check MUST call imported policy helpers; an active
blocked approval emits approval/blocked at the :status VALUE with an explanatory
message. Draft blocked approvals project normally. main imports approval and
has at least three declarations: two valid active approvals and a blocked draft.
Hidden registers contain several declarations with TWO independent errors;
return both at their original author positions. Use real calendar boundaries,
not special cases for samples. Synthetic procurement exercise.

Target: 20–60 minutes. Write the requested files in the sandbox root. Do not edit supplied context.
Use `forma check main.lisp`, `forma file evaluate main.lisp`, and (for forms)
`forma file declarations main.lisp`. Hidden tests import your public API, vary
inputs, and check diagnostics and source locations. Use only `.lisp` for Forma
source. No network or dependencies are needed.
