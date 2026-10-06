# Processes

```lisp
(export client-onboarding matter-opening document-follow-up)

;; =============================================================================
;; Law Firm Backoffice Ontology - Processes
;; =============================================================================

;; ---------------------------------------------------------------------------
;; Client Onboarding Process
;; ---------------------------------------------------------------------------
;; When a new client is created, collect intake, run conflicts, prepare the
;; engagement letter, and open the matter only after the preconditions clear.

(process client-onboarding :description "New client onboarding: intake packet, conflict check, engagement letter, and matter opening" :trigger (on-create Client)
 (node create-intake :action create-intake-packet   :input {:entity-id (-> context (get :entityId))})
 (node run-conflicts :action run-conflict-check   :input {:entity-id (-> context (get :entityId))})
 (node notify-attorney :action send-notification   :input {:to (-> context (get :attorneyEmail)) :subject "New client intake is ready for conflict review"})
 (node open-matter-shell :action open-matter   :input {:entity-id (-> context (get :entityId))})
 (edge create-intake run-conflicts)
 (edge run-conflicts notify-attorney)
 (edge notify-attorney open-matter-shell))

;; ---------------------------------------------------------------------------
;; Matter Opening Process
;; ---------------------------------------------------------------------------
;; When a matter opens, create the engagement letter, assign opening tasks,
;; and request the client's initial documents.

(process matter-opening :description "Matter opening: engagement letter, opening task, and initial document request" :trigger (on-create Matter)
 (node engagement-letter :action generate-engagement-letter   :input {:entity-id (-> context (get :entityId))})
 (node opening-task :action add-case-task   :input {:entity-id (-> context (get :entityId))})
 (node initial-documents :action request-documents   :input {:entity-id (-> context (get :entityId))})
 (node activate :action activate-matter   :input {:entity-id (-> context (get :entityId))})
 (edge engagement-letter opening-task)
 (edge opening-task initial-documents)
 (edge initial-documents activate))

;; ---------------------------------------------------------------------------
;; Document Follow-Up Process
;; ---------------------------------------------------------------------------
;; Overdue document requests create a structured escalation path so the firm can
;; separate routine reminders from attorney intervention.

(process document-follow-up :description "Overdue document request follow-up and attorney escalation" :trigger (on-create DocumentRequest)
 (node reminder :action send-notification   :input {:subject "Document request reminder"})
 (node escalation-check :action escalate-to-attorney  :fan-out "first")
 (edge reminder escalation-check))
```
