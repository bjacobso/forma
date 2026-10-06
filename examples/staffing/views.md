# Views

```lisp
(export
  onboarding-workers-view
  employer-review-queue-view
  generated-documents-view
  pending-documents-view
  employees-rest-resource-view
  clients-rest-resource-view
  onboarding-dashboard
  onboarding-tracker
  employer-inbox
  runtime-task-queue-view
  active-violations-view
  resolved-violations-view
  i9-submission-mapping-view
  employee-profile-dashboard
  runtime-task-detail-native
  violation-detail-native
  active-client-portfolio-view
  profitable-active-placements)

;; =============================================================================
;; Staffing Agency Ontology - Canonical Views
;; =============================================================================
;;
;; These views lean on the richer ViewSpec surface: guide cards, tab sets,
;; alerts, charts, and narrative groupings instead of flat table browsers.
;;
(view onboarding-workers-view
  :query onboarding-employees
  :subject session
  :title "Workers In Onboarding"
  :description "New hires whose onboarding process is still in flight."
  :mode "table"
  :empty-state "No workers are currently onboarding."
  :default-sort [employee/hire-date :asc]
  :row-action :read
  (column :employee/first-name)
  (column :employee/last-name)
  (column :employee/hire-date))
(view employer-review-queue-view
  :query employer-review-tasks
  :subject session
  :title "Employer Review Queue"
  :description "Live runtime tasks waiting on employer-side onboarding review."
  :mode "table"
  :empty-state "No employer review tasks are waiting right now."
  :default-sort [task/due-date :asc]
  :row-action :read
  (column :task/title)
  (column :task/completion-document-ref)
  (column :task/priority)
  (column :task/status)
  (column :task/due-date))
(view generated-documents-view
  :query generated-documents
  :subject session
  :title "Pending Generated Docs"
  :description
    "Documents created by onboarding flows that still need follow-up."
  :mode "table"
  :empty-state "No generated documents need attention."
  :default-sort [document/created-at :desc]
  :row-action :read
  (column :document/name)
  (column :document/type)
  (column :document/status)
  (column :document/created-at))
(view pending-documents-view
  :query pending-documents
  :subject session
  :title "Pending Documents"
  :description "A deliberate empty-state demo for document operations."
  :mode "table"
  :empty-state "No pending documents are currently waiting for the team."
  :default-sort [document/created-at :desc]
  :row-action :read
  (column :document/name)
  (column :document/type)
  (column :document/status)
  (column :document/created-at))
(view employees-rest-resource-view
  :subject session
  :title "Employees REST Resource"
  :description "Versioned REST access for Employee records."
  :layout
    (rows
      (heading "Employees REST Resource")
      (table
        {
          :bind (query employees)
          :columns
            [
              {:key "?employee_first_name" :label "First Name"}
              {:key "?employee_last_name" :label "Last Name"}
              {:key "?employee_email" :label "Email"}
              {:key "?employee_status" :label "Status"}
              {:key "?employee_hire_date" :label "Hire Date"}]
          :filters
            [
              {
                :key "?employee_last_name"
                :label "Last Name"
                :placeholder "Filter by last name..."}
              {
                :key "?employee_status"
                :label "Status"
                :placeholder "Filter by status..."}]
          :page-size 10
          :default-sort {:key "?employee_last_name" :direction "asc"}
          :on-row-click
            [
              (set-state :selectedEmployee (get $row :?it))
              (open-dialog "employee-detail-sheet")]
          :empty-state "No employees found."})
      (dialog
        {
          :dialog-id "employee-detail-sheet"
          :title "Employee Record"
          :description "Review the selected Employee entity."}
        (entity-detail {:entity-id (state selectedEmployee)})))
  :state {:selectedEmployee {:initial nil :kind "null"}}
  :queries {:employees {:ref "employees-rest-resource"}})
(view clients-rest-resource-view
  :subject session
  :title "Clients REST Resource"
  :description "Versioned REST access for Client records."
  :layout
    (rows
      (heading "Clients REST Resource")
      (table
        {
          :bind (query clients)
          :columns
            [
              {:key "?client_name" :label "Client"}
              {:key "?client_industry" :label "Industry"}
              {:key "?client_email" :label "Email"}
              {:key "?client_status" :label "Status"}]
          :filters
            [
              {
                :key "?client_name"
                :label "Client"
                :placeholder "Filter by client..."}
              {
                :key "?client_status"
                :label "Status"
                :placeholder "Filter by status..."}]
          :page-size 10
          :default-sort {:key "?client_name" :direction "asc"}
          :on-row-click
            [
              (set-state :selectedClient (get $row :?it))
              (open-dialog "client-detail-sheet")]
          :empty-state "No clients found."})
      (dialog
        {
          :dialog-id "client-detail-sheet"
          :title "Client Record"
          :description "Review the selected Client entity."}
        (entity-detail {:entity-id (state selectedClient)})))
  :state {:selectedClient {:initial nil :kind "null"}}
  :queries {:clients {:ref "clients-rest-resource"}})
(view onboarding-dashboard
  :subject session
  :title "Onboarding Dashboard"
  :description
    "Operational story of the current hiring pipeline and its live work queue."
  :layout
    (rows
      (heading "Onboarding Operations")
      (columns
        (create-entity-button
          {
            :entity-type "Employee"
            :label "Create Employee"
            :variant "default"
            :on-success
              (execute-action
                "hire-existing-employee"
                "employer:acme"
                (:parameters {:employee (get $result :entityId)})
                (:on-success
                  [
                    (run-queries
                      [onboarding employer-review runtime-tasks violations])
                    (show-toast
                      "Employee created"
                      (:description "Ready to hire from the dashboard."))]))})
        (action-button
          {
            :action-ref "hire-existing-employee"
            :label "Hire Existing Employee"
            :variant "outline"}))
      (card
        {:title "Hire Existing Employee"}
        (rows
          (markdown
            "Pick an existing employee directly from the dashboard and open the hire flow with the employee pre-selected.")
          (entity-picker
            {
              :name "selectedEmployee"
              :label "Employee"
              :entity-type "Employee"
              :placeholder "Select employee to hire"})
          (action-button
            {
              :action-ref "hire-existing-employee"
              :label "Hire Selected Employee"
              :entity-id "employer:acme"
              :parameters {:employee (get (state selectedEmployee) :entityId)}
              :variant "secondary"
              :visible (not (nil? (state selectedEmployee)))
              :on-success
                [
                  (run-queries
                    [onboarding employer-review runtime-tasks violations])
                  (set-state :selectedEmployee nil)]})))
      (stat-group
        (metric {:label "In Onboarding" :value (length (query onboarding))})
        (metric
          {:label "Active Workers" :value (length (query active-workers))})
        (metric
          {:label "Employer Review" :value (length (query employer-review))})
        (metric {:label "Runtime Tasks" :value (length (query runtime-tasks))})
        (metric {:label "Violations" :value (length (query violations))}))
      (condition
        (case
          {:when (> (length (query violations)) 0)}
          (card
            {
              :title "Active Violations"
              :description
                "Constraint output that is currently blocking onboarding."
              :action
                (badge
                  {:content (length (query violations)) :variant "destructive"})}
            (item-group
              {:bind (query violations)}
              (item
                {
                  :variant "muted"
                  :icon "alert-triangle"
                  :title (get $item :?violation_constraint_name)
                  :description (get $item :?violation_message)
                  :badge (get $item :?violation_severity)
                  :badge-variant "outline"}))))
        (else
          (empty-state
            {
              :icon "check-circle"
              :title "No Active Violations"
              :description
                "No onboarding cases are currently blocked by intrinsic compliance rules."})))
      (card
        {:title "Current Queue"}
        (condition
          (case
            {:when (> (length (query onboarding)) 0)}
            (item-group
              {:bind (query onboarding)}
              (item
                {
                  :variant "outline"
                  :icon "user-round"
                  :title (get $item :?employee_first_name)
                  :description (get $item :?employee_last_name)
                  :badge "Onboarding"
                  :badge-variant "secondary"})))
          (else
            (empty-state
              {
                :icon "users"
                :title "No workers in onboarding"
                :description
                  "New hires will appear here as soon as a staffing workflow starts."})))))
  :state {:selectedEmployee {:initial nil :kind "null"}}
  :queries
    {
      :onboarding {:ref "onboarding-employees"}
      :active-workers {:ref "active-employees"}
      :employer-review {:ref "employer-review-tasks"}
      :runtime-tasks {:ref "open-runtime-tasks"}
      :violations {:ref "active-violations"}})
(view onboarding-tracker
  :subject session
  :title "Onboarding Tracker"
  :description "Employees currently in the onboarding process."
  :layout
    (rows
      (heading "Onboarding Tracker")
      (table
        {
          :bind (query onboarding)
          :columns
            [
              {:key "?employee_first_name" :label "First Name"}
              {:key "?employee_last_name" :label "Last Name"}
              {:key "?employee_hire_date" :label "Hire Date" :kind "date"}
              {:key "?employee_status" :label "Status" :kind "status"}]
          :default-sort {:key "?employee_hire_date" :direction "asc"}
          :on-row-click (set-state :selected (get $row :?it))
          :empty-state "No employees are currently onboarding."})
      (card
        {:visible (not (nil? (state selected)))}
        (action-button
          {
            :action-ref "complete-onboarding"
            :label "Complete Onboarding"
            :entity-id-bind (state selected)
            :variant "default"
            :on-success [(run-query onboarding) (set-state :selected nil)]})))
  :state {:selected {:initial nil :kind "null"}}
  :queries {:onboarding {:ref "onboarding-with-ids"}})
(view employer-inbox
  :subject session
  :title "Employer Inbox"
  :description
    "Pending employer-assigned runtime tasks that keep new hires moving."
  :layout
    (rows
      (heading "Employer Inbox")
      (condition
        (case
          {:when (> (length (query employer-pending)) 0)}
          (alert
            {
              :variant "warning"
              :message
                "Employer review is waiting on one or more pending tasks."}))
        (else
          (alert
            {
              :variant "info"
              :message "No employer tasks are currently pending."})))
      (table
        {
          :bind (query employer-pending)
          :columns
            [
              {:key "?task_title" :label "Task"}
              {:key "?task_completion_document_ref" :label "Document"}
              {:key "?task_priority" :label "Priority" :kind "priority"}
              {:key "?task_status" :label "Status" :kind "status"}
              {:key "?task_due_date" :label "Due Date" :kind "date"}]
          :empty-state "No pending employer tasks."}))
  :queries {:employer-pending {:ref "employer-pending-tasks"}})
(view runtime-task-queue-view
  :subject session
  :title "Tasks & Compliance"
  :description "Workflow automation output and violations in one place."
  :layout
    (rows
      (heading "Tasks & Compliance")
      (card
        {:title "What this view shows" :visible (state show-guide)}
        (rows
          (markdown
            "Runtime tasks come from workflow automation. Violations come from the constraint engine. Keeping them together makes it clear which process work is reactive and which work is blocking compliance.")))
      (stat-group
        (metric {:label "Runtime Tasks" :value (length (query runtime-tasks))})
        (metric {:label "Violations" :value (length (query violations))}))
      (tabs
        (tab-panel
          {:title "Runtime Tasks"}
          (table
            {
              :bind (query runtime-tasks)
              :columns
                [
                  {:key "?task_title" :label "Task"}
                  {:key "?task_priority" :label "Priority"}
                  {:key "?task_status" :label "Status"}
                  {:key "?task_due_date" :label "Due Date"}]
              :empty-state "No runtime tasks are currently waiting."}))
        (tab-panel
          {:title "Violations"}
          (condition
            (case
              {:when (> (length (query violations)) 0)}
              (item-group
                {:bind (query violations)}
                (item
                  {
                    :variant "muted"
                    :icon "shield-alert"
                    :title (get $item :?violation_constraint_name)
                    :description (get $item :?violation_message)
                    :value (get $item :?violation_detected_at)
                    :badge (get $item :?violation_severity)
                    :badge-variant "outline"})))
            (else
              (empty-state
                {
                  :icon "check-circle"
                  :title "No active violations"
                  :description "The constraint engine is clear right now."}))))))
  :state {:show-guide {:initial true :kind "boolean"}}
  :queries
    {
      :runtime-tasks {:ref "open-runtime-tasks"}
      :violations {:ref "active-violations"}})
(view active-violations-view
  :subject session
  :title "Active Violations"
  :description "Intrinsic violation records emitted by the constraint engine."
  :layout
    (rows
      (workflow-strip
        {
          :title "Clearance Flow"
          :description
            "Requirements surface as live operational records before they disappear into workflow automation."}
        (workflow-step
          {
            :label "Requirement Detected"
            :description
              "Intrinsic constraint output turns missing evidence into tracked work."
            :status "attention"})
        (workflow-step
          {
            :label "Employee Action"
            :description
              "Employee-side work will satisfy the first missing requirement."
            :status "upcoming"})
        (workflow-step
          {
            :label "Employer Review"
            :description
              "Employer-side attestation follows the employee submission."
            :status "upcoming"})
        (workflow-step
          {
            :label "Cleared"
            :description
              "The case resolves when evidence satisfies the underlying constraint."
            :status "upcoming"}))
      (table
        {
          :bind (query active)
          :columns
            [
              {:key "?violation_constraint_name" :label "Constraint Name"}
              {:key "?violation_severity" :label "Severity" :kind "severity"}
              {:key "?violation_message" :label "Message"}
              {:key "?violation_entity_id" :label "Entity Id" :kind "mono"}
              {:key "?violation_task_id" :label "Task Id" :kind "mono"}
              {:key "?violation_detected_at" :label "Detected" :kind "date"}]
          :default-sort {:key "?violation_detected_at" :direction "desc"}
          :empty-state "No active violations found."}))
  :queries {:active {:ref "active-violations"}})
(view resolved-violations-view
  :subject session
  :title "Resolved Violations"
  :description
    "Compliance issues that have been cleared by workflow automation or coordinator action."
  :layout
    (rows
      (workflow-strip
        {
          :title "Clearance Flow"
          :description
            "This record shows the workflow path after the underlying requirement has been satisfied."}
        (workflow-step
          {
            :label "Requirement Detected"
            :description "The onboarding case became visible as a violation."
            :status "complete"})
        (workflow-step
          {
            :label "Employee Action"
            :description
              "Employee evidence was submitted into the same clearance case."
            :status "complete"})
        (workflow-step
          {
            :label "Employer Review"
            :description
              "Employer attestation completed the required evidence trail."
            :status "complete"})
        (workflow-step
          {
            :label "Cleared"
            :description
              "Automation closed the violation and kept the audit record visible."
            :status "complete"}))
      (violation-list
        {
          :title "Resolved Violations"
          :description "Cleared issues with resolution dates and resolver."
          :status "resolved"
          :entity-id (input entityId)
          :constraint-id (input constraintId)
          :empty-message "No violations have been resolved yet."}))
  :input {:entityId String :constraintId String})
(view i9-submission-mapping-view
  :subject session
  :title "I-9 Submission Mapping"
  :description "Submitted Section 1 data written back to the Employee entity."
  :layout
    (rows
      (workflow-strip
        {
          :title "Clearance Flow"
          :description
            "Section 1 is complete and its form values now exist as employee facts instead of isolated form state."}
        (workflow-step
          {
            :label "Requirement Detected"
            :description "The onboarding case created employee-side work."
            :status "complete"})
        (workflow-step
          {
            :label "Employee Section 1"
            :description
              "Submitted values now write back into the employee record."
            :status "complete"})
        (workflow-step
          {
            :label "Employer Review"
            :description
              "Employer-side attestation is the next gate in the case."
            :status "upcoming"})
        (workflow-step
          {
            :label "Cleared"
            :description
              "The violation resolves only after both sides of the evidence trail exist."
            :status "upcoming"}))
      (custom
        {
          :component-name "runtime/bound-attribute-list"
          :title "Submitted fields on Employee"
          :description "Bound document fields after Section 1 submission."
          :entity-id (input entityId)
          :fields
            [
              {:field "First Name" :attribute ":employee/first-name"}
              {:field "Last Name" :attribute ":employee/last-name"}
              {:field "Email Address" :attribute ":employee/email"}
              {:field "Date of Birth" :attribute ":employee/date-of-birth"}
              {:field "Social Security Number" :attribute ":employee/ssn"}
              {
                :field "Citizenship Status"
                :attribute ":employee/i9-citizenship-status"}
              {
                :field "Employee Signature"
                :attribute ":employee/i9-section-1-signed"}]}))
  :input {:entityId String})
(view employee-profile-dashboard
  :input {:subject String}
  :subject required
  :title "Employee Profile"
  :description "Employee-facing onboarding tasks and completed work."
  :layout
    (rows
      (heading "Employee Profile")
      (custom
        {
          :component-name "runtime/employee-task-list"
          :title "My Tasks"
          :description
            "Open onboarding tasks and submitted work for this employee."
          :entity-id (input subject)
          :assigned-role "employee"})
      (custom
        {
          :component-name "runtime/bound-attribute-list"
          :title "Submitted I-9 Data"
          :description "Values written back from submitted employee forms."
          :entity-id (input subject)
          :fields
            [
              {:field "Date of Birth" :attribute ":employee/date-of-birth"}
              {:field "Social Security Number" :attribute ":employee/ssn"}
              {
                :field "Citizenship Status"
                :attribute ":employee/i9-citizenship-status"}
              {
                :field "Employee Signature"
                :attribute ":employee/i9-section-1-signed"}]})))
(view violation-history
  :subject session
  :title "Violation History"
  :description "Reusable violation timeline fragment."
  :layout
    (card
      (heading "History")
      (violation-timeline {:violation-id (input violationId)}))
  :fragment true
  :input {:violationId String})
(view runtime-task-detail-native
  :subject session
  :title "Task Detail"
  :description
    "Runtime task detail rendered directly inside the staffing workspace."
  :layout
    (rows
      (workflow-strip
        {
          :title "Clearance Flow"
          :description
            "This employer task is the operational handoff between employee-submitted evidence and final clearance."}
        (workflow-step
          {
            :label "Requirement Detected"
            :description "The clearance case created follow-up work."
            :status "complete"})
        (workflow-step
          {
            :label "Employee Section 1"
            :description "Employee identity data has already been submitted."
            :status "complete"})
        (workflow-step
          {
            :label "Employer Section 2"
            :description "Employer review is the active step on this page."
            :status "current"})
        (workflow-step
          {
            :label "Cleared"
            :description
              "Completing this task will allow the violation to resolve."
            :status "upcoming"}))
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
(view violation-detail-native
  :subject session
  :title "Violation Detail"
  :description
    "Violation summary and event chronology rendered natively in the staffing workspace."
  :layout
    (rows
      (workflow-strip
        {
          :title "Clearance Flow"
          :description
            "The violation stays visible even after automation resolves it, so the case remains auditable."}
        (workflow-step
          {
            :label "Requirement Detected"
            :description "The case began as a blocking compliance issue."
            :status "complete"})
        (workflow-step
          {
            :label "Employee Section 1"
            :description
              "Employee evidence was written back into the operational record."
            :status "complete"})
        (workflow-step
          {
            :label "Employer Section 2"
            :description
              "Employer attestation completed the required evidence trail."
            :status "complete"})
        (workflow-step
          {
            :label "Cleared"
            :description
              "Automation resolved the violation and preserved the event timeline."
            :status "complete"}))
      (use violation-summary-panel)
      (split-pane
        {:sizes [58 42]}
        (rows (use violation-status-panel) (use violation-related-panel))
        (view-ref
          {:name "violation-history" :input {:violationId (input violationId)}})))
  :input {:violationId String}
  :defs
    {
      :violation-summary-panel
        (card (violation-summary {:violation-id (input violationId)}))
      :violation-status-panel
        (card (violation-status-editor {:violation-id (input violationId)}))
      :violation-related-panel
        (card (violation-related-records {:violation-id (input violationId)}))})
(view active-client-portfolio-view
  :subject optional
  :title "Client Portfolio"
  :description
    "Account-management view of active clients and current staffing load."
  :layout
    (rows
      (heading "Client Portfolio")
      (card
        {:title "Portfolio narrative" :visible (state show-guide)}
        (rows
          (markdown
            "This workspace is for account owners. It balances client coverage, placement economics, and current onboarding load without dropping back to the generic admin UI.")))
      (stat-group
        (metric {:label "Clients" :value (length (query clients))})
        (metric {:label "Placements" :value (length (query placements))})
        (metric {:label "Onboarding" :value (length (query onboarding))}))
      (columns
        (card
          {:title "Active Clients"}
          (table
            {
              :bind (query clients)
              :columns
                [
                  {:key "?client_name" :label "Client"}
                  {:key "?client_industry" :label "Industry"}
                  {:key "?client_email" :label "Email"}
                  {:key "?client_status" :label "Status"}]
              :empty-state "No active clients found."}))
        (card
          {:title "Placement Rates"}
          (chart
            {
              :variant "bar"
              :bind (query placements)
              :categoryKey "?placement_start_date"
              :series
                [
                  {:dataKey "?placement_bill_rate" :label "Bill Rate"}
                  {:dataKey "?placement_pay_rate" :label "Pay Rate"}]}))))
  :state {:show-guide {:initial true :kind "boolean"}}
  :queries
    {
      :clients {:ref "active-clients"}
      :placements {:ref "active-placements"}
      :onboarding {:ref "onboarding-employees"}})
(view profitable-active-placements
  :subject optional
  :title "Placements & Margin"
  :description "Quick scan of active placements where spread is positive."
  :layout
    (rows
      (heading "Placements & Margin")
      (card
        {:title "Margin focus" :visible (state show-guide)}
        (rows
          (markdown
            "This view highlights placements with positive spread so account managers can quickly see where economics are healthy and where a deeper review might be needed.")))
      (stat-group
        (metric
          {:label "Profitable Placements" :value (length (query placements))}))
      (columns
        (card
          {:title "Profitable Placements"}
          (table
            {
              :bind (query placements)
              :columns
                [
                  {:key "?placement_status" :label "Status"}
                  {:key "?placement_pay_rate" :label "Pay Rate"}
                  {:key "?placement_bill_rate" :label "Bill Rate"}]
              :empty-state "No profitable active placements right now."}))
        (card
          {:title "Rate Comparison"}
          (chart
            {
              :variant "bar"
              :bind (query placements)
              :categoryKey "?placement_status"
              :series
                [
                  {:dataKey "?placement_bill_rate" :label "Bill Rate"}
                  {:dataKey "?placement_pay_rate" :label "Pay Rate"}]}))))
  :state {:show-guide {:initial true :kind "boolean"}}
  :queries {:placements {:ref "profitable-placements"}})
```
