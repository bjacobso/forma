(type PlaybookIR {:kind "Playbook" :name Symbol :severity String :summary String})

(form (playbook name severity summary)
  :types {:name (Declares Playbook) :severity String :summary String}
  :ir PlaybookIR
  :check (fn [{:keys [severity summary]}]
    (if (= summary "")
      [{:severity :error
        :code "playbook/empty-summary"
        :message "Provide a non-empty playbook summary."
        :slot :summary}]
      (if (or (= severity "sev1") (or (= severity "sev2") (= severity "sev3")))
        []
        [{:severity :error
          :code "playbook/invalid-severity"
          :message "Severity must be sev1, sev2, or sev3."
          :slot :severity}])))
  {:kind "Playbook" :name name :severity severity :summary summary})
