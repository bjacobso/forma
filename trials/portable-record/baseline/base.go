// Directly written by the implementing LLM, without the generator.
package main

type Query struct {
	F_id     string `json:"id"`
	F_cursor string `json:"cursor"`
}
type Raw struct {
	Raw string `json:"raw"`
}
type UserFields struct {
	F_id     Raw `json:"id"`
	F_cursor Raw `json:"cursor"`
}

func Wrap(q Query) UserFields {
	return UserFields{F_id: Raw{Raw: q.F_id}, F_cursor: Raw{Raw: q.F_cursor}}
}
