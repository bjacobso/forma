(export flow-child/step)
(type StepIR {:label String})
(form (flow-child/step label) :types {:label String} :ir StepIR {:label label})
(define flow-child/step 1)
