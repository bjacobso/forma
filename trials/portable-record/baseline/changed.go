// Direct maintenance: rename id and add label in types and value construction.
package main

type Query struct {
	F_account_id string `json:"account_id"`
	F_cursor     string `json:"cursor"`
	F_label      string `json:"label"`
}
type Raw struct {
	Raw string `json:"raw"`
}
type UserFields struct {
	F_account_id Raw `json:"account_id"`
	F_cursor     Raw `json:"cursor"`
	F_label      Raw `json:"label"`
}

func Wrap(q Query) UserFields {
	return UserFields{F_account_id: Raw{Raw: q.F_account_id}, F_cursor: Raw{Raw: q.F_cursor}, F_label: Raw{Raw: q.F_label}}
}
