---
id: todo-app
version: 1.0.0
description: Todo list application ontology
preludes:
  - core
---

# Todo Application Ontology

A simple todo list application with support for adding, listing, and marking tasks as complete.

## Entity: Todo

Represents a task item in the todo list.

```lisp
(entity Todo {:title String
    :completed (Option Bool :default false)})
```

## Queries

### List All Todos

Returns all todo items in the system.

```lisp
(query list-todos
  :from Todo
  :select [title completed])
```

### List Incomplete Todos

Returns only todos that haven't been completed yet.

```lisp
(query list-incomplete-todos
  :from Todo
  :where (match completed (Some __completed) (= __completed false) None false)
  :select [title])
```

## Actions

### Add Todo

Creates a new todo item with the given title and returns its entity id.

```lisp
(: add-todo (-> String (Action (Id Todo))))
(define add-todo [title] (create! Todo {:title title :completed false}))
```

### Mark Todo as Done

Updates a todo item to mark it as completed.

```lisp
(: mark-done (-> (Id Todo) (Action Bool)))
(define mark-done [todo] (do! [_ (update! Todo todo {:completed true})] true))
```

### Delete Todo

Retracts the current todo facts from the system while preserving time-travel history.

```lisp
(: delete-todo (-> (Id Todo) (Action Bool)))
(define delete-todo [todo] (do! [_ (retract! Todo todo)] true))
```

## View: Todo List Manager

A comprehensive view for managing the todo list with add, complete, and delete capabilities.

```lisp
(view todo-list-manager :query list-todos :subject session :title "Todo List Manager" :description "Add todos, inspect all tasks, and run completion or delete actions." :layout (rows
      (heading "Todo List Manager")
      (columns
        (input {:name "newTitle"
                :label "Task"
                :placeholder "What needs to be done?"})
        (action-button {:action-ref "add-todo"
                        :label "Add Todo"
                        :parameters {:title (state newTitle)}
                        :variant "default"}))
      (table {:bind (query todos)
              :columns [{:key "?title" :label "Task"}
                        {:key "?completed" :label "Done" :kind "boolean"}
                        {:key "?id" :label "ID" :kind "mono"}]
              :empty-state "No todos yet."})
      (columns
        (entity-picker {:name "selectedTodo"
                        :label "Todo"
                        :entity-type "Todo"
                        :placeholder "Select todo"})
        (action-button {:action-ref "mark-done"
                        :label "Mark Complete"
                        :parameters {:todo (get (state selectedTodo) :entityId)}
                        :variant "secondary"
                        :visible (not (nil? (state selectedTodo)))})
        (action-button {:action-ref "delete-todo"
                        :label "Delete"
                        :parameters {:todo (get (state selectedTodo) :entityId)}
                        :variant "destructive"
                        :visible (not (nil? (state selectedTodo)))}))) :state {:newTitle {:initial "" :kind "string"} :selectedTodo {:initial nil :kind "null"}} :queries {:todos {:ref "list-todos"}})
```
