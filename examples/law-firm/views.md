# Views

```lisp
(export
  backoffice-dashboard
  client-onboarding-view
  matter-management-view
  document-requests-view
  billing-review-view
  runtime-task-detail-native
  managing-partner-summary
  client-portfolio-view
  high-risk-clients-view)

;; =============================================================================
;; Law Firm Backoffice Ontology - Views
;; =============================================================================
(view backoffice-dashboard
  :subject session
  :title "Backoffice Dashboard"
  :description
    "Firm-wide intake, conflict, document, task, and billing posture."
  :layout
    (rows
      (heading "Backoffice Dashboard")
      (card
        {:title "Daily operating posture" :visible (state show-guide)}
        (rows
          (markdown
            "This dashboard pulls together the queues that make a law firm backoffice drift: prospective clients waiting on intake, conflicts needing review, document requests past due, urgent matter tasks, and invoices that need attorney approval.")))
      (stat-group
        (metric
          {:label "Onboarding Clients" :value (length (query onboarding))})
        (metric
          {:label "Attorney Conflict Reviews" :value (length (query conflicts))})
        (metric {:label "Urgent Tasks" :value (length (query urgent))})
        (metric {:label "Billing Reviews" :value (length (query invoices))}))
      (card
        {
          :title "Operational Coverage"
          :description "Composite health signal for current backoffice work."
          :footer
            (text
              {
                :content
                  "The score combines intake progress, open urgent tasks, and billing review load."})}
        (progress
          {
            :value 68
            :label "Backoffice Coverage"
            :hint "68% of tracked work is on-track today."}))
      (toggle-group
        {
          :name "riskFilter"
          :mode "single"
          :variant "outline"
          :options ["All" "Urgent" "Stable"]})
      (condition
        (case
          {:when (> (length (query conflicts)) 0)}
          (alert
            {
              :variant "warning"
              :message
                "Potential conflicts need attorney review before any matter opens."}))
        (else
          (alert
            {
              :variant "info"
              :message "No conflict checks are currently escalated."})))
      (columns
        (card
          {
            :title "Urgent Matter Tasks"
            :action
              (badge {:content (length (query urgent)) :variant "destructive"})}
          (condition
            (case
              {:when (> (length (query urgent)) 0)}
              (item-group
                {:bind (query urgent)}
                (item
                  {
                    :variant "muted"
                    :icon "alert-triangle"
                    :title (get $item :?casetask_title)
                    :description (get $item :?casetask_type)
                    :value (get $item :?casetask_due_date)
                    :badge (get $item :?casetask_status)
                    :badge-variant "outline"})))
            (else
              (empty-state
                {
                  :icon "check-circle"
                  :title "No urgent tasks"
                  :description "The firm is clear of urgent backoffice work."}))))
        (card
          {:title "Invoices Needing Review"}
          (table
            {
              :bind (query invoices)
              :columns
                [
                  {:key "?invoice_number" :label "Invoice"}
                  {:key "?invoice_amount" :label "Amount"}
                  {:key "?invoice_status" :label "Status"}
                  {:key "?invoice_due_date" :label "Due"}]
              :empty-state "No invoices need review."}))))
  :state
    {
      :show-guide {:initial true :kind "boolean"}
      :riskFilter {:initial "All" :kind "string"}}
  :queries
    {
      :urgent {:ref "urgent-case-tasks"}
      :onboarding {:ref "onboarding-clients"}
      :conflicts {:ref "conflicts-needing-attorney-review"}
      :documents {:ref "overdue-document-requests"}
      :invoices {:ref "invoices-needing-review"}
      :violations {:ref "active-violations"}})
(view client-onboarding-view
  :subject session
  :title "Client Onboarding"
  :description
    "Prospective client intake from submitted packet through conflicts and engagement letter."
  :layout
    (rows
      (heading "Client Onboarding")
      (columns
        (create-entity-button
          {
            :entity-type "Client"
            :label "Create Client"
            :variant "default"
            :on-success
              (execute-action
                "create-intake-packet"
                (get $result :entityId)
                (:on-success
                  [
                    (run-queries [clients intake conflicts letters])
                    (show-toast
                      "Client created"
                      (:description "Intake packet and conflict check opened."))]))}))
      (card
        {:title "Onboarding pipeline" :visible (state show-guide)}
        (rows
          (markdown
            "The onboarding workflow is deliberately staged: collect intake, clear conflicts, send the engagement letter, then open the matter. The same client can have multiple future matters, but no matter should open before the firm has cleared conflicts and captured a signed engagement letter.")))
      (stat-group
        (metric {:label "Prospective Clients" :value (length (query clients))})
        (metric {:label "Intake Reviews" :value (length (query intake))})
        (metric {:label "Pending Conflicts" :value (length (query conflicts))})
        (metric {:label "Unsigned Letters" :value (length (query letters))}))
      (tabs
        (tab-panel
          {:title "Clients"}
          (table
            {
              :bind (query clients)
              :columns
                [
                  {:key "?client_name" :label "Client"}
                  {:key "?client_type" :label "Type"}
                  {:key "?client_industry" :label "Industry"}
                  {:key "?client_risk_level" :label "Risk"}
                  {:key "?client_email" :label "Email"}]
              :empty-state "No clients are currently onboarding."}))
        (tab-panel
          {:title "Intake Review"}
          (table
            {
              :bind (query intake)
              :columns
                [
                  {:key "?intakepacket_status" :label "Status"}
                  {:key "?intakepacket_submitted_at" :label "Submitted"}
                  {:key "?intakepacket_notes" :label "Notes"}]
              :empty-state "No submitted intake packets need review."}))
        (tab-panel
          {:title "Conflicts"}
          (rows
            (condition
              (case
                {:when (> (length (query conflict-review)) 0)}
                (alert
                  {
                    :variant "warning"
                    :message
                      "Some conflict checks require attorney review before proceeding."}))
              (else
                (alert
                  {:variant "info" :message "No conflict checks are escalated."})))
            (table
              {
                :bind (query conflicts)
                :columns
                  [
                    {:key "?conflictcheck_status" :label "Status"}
                    {:key "?conflictcheck_search_terms" :label "Search Terms"}
                    {:key "?conflictcheck_result" :label "Result"}
                    {:key "?conflictcheck_notes" :label "Notes"}]
                :empty-state "No conflict checks are pending."})))
        (tab-panel
          {:title "Engagement Letters"}
          (table
            {
              :bind (query letters)
              :columns
                [
                  {:key "?engagementletter_status" :label "Status"}
                  {:key "?engagementletter_sent_at" :label "Sent"}
                  {:key "?engagementletter_fee_type" :label "Fee Type"}
                  {:key "?engagementletter_scope_summary" :label "Scope"}]
              :empty-state "No engagement letters are outstanding."}))))
  :state {:show-guide {:initial true :kind "boolean"}}
  :queries
    {
      :clients {:ref "onboarding-clients"}
      :intake {:ref "intake-packets-needing-review"}
      :conflicts {:ref "pending-conflict-checks"}
      :conflict-review {:ref "conflicts-needing-attorney-review"}
      :letters {:ref "engagement-letters-outstanding"}})
(view matter-management-view
  :subject session
  :title "Matter Management"
  :description "Active matters and open case tasks across the firm."
  :layout
    (rows
      (heading "Matter Management")
      (card
        {:title "Matter work" :visible (state show-guide)}
        (rows
          (markdown
            "Once onboarding is complete, the backoffice view shifts to active matters: deadlines, budgets, open case tasks, and administrative work that has to stay synchronized with attorney review.")))
      (tabs
        (tab-panel
          {:title "Active Matters"}
          (table
            {
              :bind (query active)
              :columns
                [
                  {:key "?matter_title" :label "Matter"}
                  {:key "?matter_practice_area" :label "Practice"}
                  {:key "?matter_fee_type" :label "Fee Type"}
                  {
                    :key "?matter_next_deadline"
                    :label "Next Deadline"
                    :kind "date"}
                  {:key "?matter_budget" :label "Budget"}]
              :empty-state "No active matters found."}))
        (tab-panel
          {:title "Opening"}
          (table
            {
              :bind (query opening)
              :columns
                [
                  {:key "?matter_title" :label "Matter"}
                  {:key "?matter_practice_area" :label "Practice"}
                  {:key "?matter_fee_type" :label "Fee Type"}
                  {:key "?matter_opened_date" :label "Opened"}]
              :empty-state "No matters are in opening status."}))
        (tab-panel
          {:title "Tasks"}
          (table
            {
              :bind (query tasks)
              :columns
                [
                  {:key "?casetask_title" :label "Task"}
                  {:key "?casetask_type" :label "Type"}
                  {:key "?casetask_priority" :label "Priority"}
                  {:key "?casetask_status" :label "Status"}
                  {:key "?casetask_due_date" :label "Due"}
                  {:key "?casetask_assignee_role" :label "Assignee"}]
              :empty-state "No open case tasks."}))))
  :state {:show-guide {:initial true :kind "boolean"}}
  :queries
    {
      :active {:ref "active-matters"}
      :opening {:ref "matters-opening"}
      :tasks {:ref "open-case-tasks"}})
(view document-requests-view
  :subject session
  :title "Document Requests"
  :description "Client-facing document requests and overdue follow-up."
  :layout
    (rows
      (heading "Document Requests")
      (condition
        (case
          {:when (> (length (query overdue)) 0)}
          (alert
            {
              :variant "warning"
              :message "Some document requests are overdue and need follow-up."}))
        (else
          (alert {:variant "info" :message "No document requests are overdue."})))
      (table
        {
          :bind (query open)
          :columns
            [
              {:key "?documentrequest_title" :label "Request"}
              {:key "?documentrequest_status" :label "Status"}
              {:key "?documentrequest_requested_from" :label "Requested From"}
              {:key "?documentrequest_due_date" :label "Due"}]
          :empty-state "No open document requests."}))
  :queries
    {
      :open {:ref "open-document-requests"}
      :overdue {:ref "overdue-document-requests"}})
(view billing-review-view
  :subject session
  :title "Billing Review"
  :description "Invoices requiring attorney or partner approval before sending."
  :layout
    (rows
      (heading "Billing Review")
      (table
        {
          :bind (query invoices)
          :columns
            [
              {:key "?invoice_number" :label "Invoice"}
              {:key "?invoice_status" :label "Status"}
              {:key "?invoice_amount" :label "Amount"}
              {:key "?invoice_issued_at" :label "Issued"}
              {:key "?invoice_due_date" :label "Due"}]
          :empty-state "No invoices need review."}))
  :queries {:invoices {:ref "invoices-needing-review"}})
(view runtime-task-detail-native
  :subject session
  :title "Task Detail"
  :description
    "Runtime task detail rendered directly inside the backoffice workspace."
  :layout
    (rows
      (heading "Task Detail")
      (use task-overview)
      (grid {:columns 2} (use task-status-panel) (use task-documents-panel))
      (use task-metadata-panel))
  :input {:taskId String}
  :defs
    {
      :task-overview (card (task-summary {:task-id (input taskId)}))
      :task-status-panel (card (task-status-editor {:task-id (input taskId)}))
      :task-documents-panel
        (card (task-document-links {:task-id (input taskId)}))
      :task-metadata-panel (card (task-metadata {:task-id (input taskId)}))})
(view managing-partner-summary
  :subject optional
  :title "Managing Partner Summary"
  :description
    "Attorney-level scan of client risk, active matters, and intake load."
  :layout
    (rows
      (heading "Managing Partner Summary")
      (card
        {:title "Portfolio context" :visible (state show-guide)}
        (rows
          (markdown
            "This summary is tuned for attorneys managing the book of business. It highlights risk concentration, active matter load, and prospective clients that are still moving through intake.")))
      (stat-group
        (metric {:label "Active Clients" :value (length (query clients))})
        (metric {:label "High-Risk Clients" :value (length (query high-risk))})
        (metric {:label "Active Matters" :value (length (query matters))})
        (metric
          {:label "Onboarding Clients" :value (length (query onboarding))}))
      (columns
        (card
          {:title "Active Matters by Budget"}
          (chart
            {
              :variant "bar"
              :bind (query matters)
              :categoryKey "?matter_title"
              :series [{:dataKey "?matter_budget" :label "Budget"}]}))
        (card
          {:title "High-Risk Clients"}
          (table
            {
              :bind (query high-risk)
              :columns
                [
                  {:key "?client_name" :label "Client"}
                  {:key "?client_type" :label "Type"}
                  {:key "?client_industry" :label "Industry"}
                  {:key "?client_status" :label "Status"}]
              :empty-state "No high-risk clients."}))))
  :state {:show-guide {:initial true :kind "boolean"}}
  :queries
    {
      :clients {:ref "active-clients"}
      :high-risk {:ref "high-risk-clients"}
      :matters {:ref "active-matters"}
      :onboarding {:ref "onboarding-clients"}})
(view client-portfolio-view
  :subject optional
  :title "Client Portfolio"
  :description "Tabbed portfolio view for client records and active matters."
  :layout
    (rows
      (heading "Client Portfolio")
      (card
        {:title "Portfolio guide" :visible (state show-guide)}
        (rows
          (markdown
            "This view keeps client records and matter work together so attorneys can move between relationship context and active legal work without losing the operational thread.")))
      (tabs
        (tab-panel
          {:title "Clients"}
          (table
            {
              :bind (query clients)
              :columns
                [
                  {:key "?client_name" :label "Client"}
                  {:key "?client_type" :label "Type"}
                  {:key "?client_industry" :label "Industry"}
                  {:key "?client_risk_level" :label "Risk"}
                  {:key "?client_email" :label "Email"}]
              :empty-state "No active clients."}))
        (tab-panel
          {:title "Matters"}
          (table
            {
              :bind (query matters)
              :columns
                [
                  {:key "?matter_title" :label "Matter"}
                  {:key "?matter_practice_area" :label "Practice"}
                  {:key "?matter_fee_type" :label "Fee Type"}
                  {
                    :key "?matter_next_deadline"
                    :label "Next Deadline"
                    :kind "date"}]
              :empty-state "No active matters."}))))
  :state {:show-guide {:initial true :kind "boolean"}}
  :queries {:clients {:ref "active-clients"} :matters {:ref "active-matters"}})
(view high-risk-clients-view
  :subject optional
  :title "High-Risk Clients"
  :description "Clients that need closer attorney oversight."
  :layout
    (rows
      (heading "High-Risk Clients")
      (table
        {
          :bind (query clients)
          :columns
            [
              {:key "?client_name" :label "Client"}
              {:key "?client_type" :label "Type"}
              {:key "?client_industry" :label "Industry"}
              {:key "?client_status" :label "Status"}
              {:key "?client_email" :label "Email"}]
          :empty-state "No high-risk clients."}))
  :queries {:clients {:ref "high-risk-clients"}})
```
