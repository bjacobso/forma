// Package effect is a prototype port of the semantic core of Effect
// (effect@4.0.3) to Go. Effects are descriptions built from a small set of
// opcodes; each fiber is one goroutine running an interpreter over them.
//
// The package ports Effect's semantics, not its scheduler: Go already
// schedules, preempts, and blocks goroutines, so the runtime only adds what
// Go lacks: typed exits with causes, interruption with uninterruptible
// regions, supervision, scopes and finalizers, memoized layers, and
// fiber-local references.
//
// This is a prototype for RFC 0019. It is not a supported Forma target.
package effect

import (
	"fmt"
	"strings"
)

// ReasonKind distinguishes the three ways a fiber can fail.
type ReasonKind uint8

const (
	// ReasonFail is an expected, typed failure (Effect's E channel).
	ReasonFail ReasonKind = iota
	// ReasonDie is a defect: a recovered panic or an explicit Die.
	ReasonDie
	// ReasonInterrupt records that the fiber was interrupted.
	ReasonInterrupt
)

// Reason is one entry of a Cause.
type Reason struct {
	Kind ReasonKind
	// Err is the failure for ReasonFail.
	Err error
	// Defect is the panic value for ReasonDie.
	Defect any
	// Stack is the goroutine stack captured when a panic was recovered.
	Stack string
	// FiberID is the interrupting fiber for ReasonInterrupt (0 outside the runtime).
	FiberID uint64
}

// Cause is why an effect did not succeed. Effect 4 represents a cause as a
// flat list of reasons rather than Effect 3's tree of sequential and parallel
// nodes; the prototype follows 4.0.3, the version Forma generates against.
// Reasons appear in the order they happened.
type Cause struct {
	reasons []Reason
}

// FailCause is a cause holding one typed failure.
func FailCause(err error) *Cause {
	return &Cause{reasons: []Reason{{Kind: ReasonFail, Err: err}}}
}

// DieCause is a cause holding one defect.
func DieCause(defect any) *Cause {
	return &Cause{reasons: []Reason{{Kind: ReasonDie, Defect: defect}}}
}

// InterruptCause is a cause recording an interruption by fiber id.
func InterruptCause(fiberID uint64) *Cause {
	return &Cause{reasons: []Reason{{Kind: ReasonInterrupt, FiberID: fiberID}}}
}

// Reasons returns the reasons in order. The slice must not be modified.
func (c *Cause) Reasons() []Reason {
	if c == nil {
		return nil
	}
	return c.reasons
}

// Combine appends the reasons of other, skipping interruptions by a fiber
// that is already recorded.
func (c *Cause) Combine(other *Cause) *Cause {
	if c == nil || len(c.reasons) == 0 {
		return other
	}
	if other == nil || len(other.reasons) == 0 {
		return c
	}
	reasons := append([]Reason(nil), c.reasons...)
	for _, reason := range other.reasons {
		if reason.Kind == ReasonInterrupt && c.interruptedBy(reason.FiberID) {
			continue
		}
		reasons = append(reasons, reason)
	}
	return &Cause{reasons: reasons}
}

func (c *Cause) interruptedBy(id uint64) bool {
	for _, reason := range c.reasons {
		if reason.Kind == ReasonInterrupt && reason.FiberID == id {
			return true
		}
	}
	return false
}

// Failure returns the first typed failure, as Effect's catch combinators do.
func (c *Cause) Failure() (error, bool) {
	for _, reason := range c.Reasons() {
		if reason.Kind == ReasonFail {
			return reason.Err, true
		}
	}
	return nil, false
}

// Failures returns every typed failure in order.
func (c *Cause) Failures() []error {
	var errs []error
	for _, reason := range c.Reasons() {
		if reason.Kind == ReasonFail {
			errs = append(errs, reason.Err)
		}
	}
	return errs
}

// Defects returns every defect in order.
func (c *Cause) Defects() []any {
	var defects []any
	for _, reason := range c.Reasons() {
		if reason.Kind == ReasonDie {
			defects = append(defects, reason.Defect)
		}
	}
	return defects
}

// IsInterrupted reports whether the cause contains an interruption.
func (c *Cause) IsInterrupted() bool {
	for _, reason := range c.Reasons() {
		if reason.Kind == ReasonInterrupt {
			return true
		}
	}
	return false
}

// IsInterruptedOnly reports whether every reason is an interruption.
func (c *Cause) IsInterruptedOnly() bool {
	reasons := c.Reasons()
	if len(reasons) == 0 {
		return false
	}
	for _, reason := range reasons {
		if reason.Kind != ReasonInterrupt {
			return false
		}
	}
	return true
}

// IsFailureOnly reports whether the cause holds typed failures and nothing
// else, which is what retry and the catch combinators may recover from.
func (c *Cause) IsFailureOnly() bool {
	reasons := c.Reasons()
	if len(reasons) == 0 {
		return false
	}
	for _, reason := range reasons {
		if reason.Kind != ReasonFail {
			return false
		}
	}
	return true
}

// withoutFailures drops typed failures, which Effect does when interruption
// skips a recovery handler.
func (c *Cause) withoutFailures() *Cause {
	var reasons []Reason
	for _, reason := range c.Reasons() {
		if reason.Kind != ReasonFail {
			reasons = append(reasons, reason)
		}
	}
	return &Cause{reasons: reasons}
}

func (c *Cause) String() string {
	parts := make([]string, 0, len(c.Reasons()))
	for _, reason := range c.Reasons() {
		switch reason.Kind {
		case ReasonFail:
			parts = append(parts, fmt.Sprintf("Fail(%v)", reason.Err))
		case ReasonDie:
			parts = append(parts, fmt.Sprintf("Die(%v)", reason.Defect))
		case ReasonInterrupt:
			parts = append(parts, fmt.Sprintf("Interrupt(#%d)", reason.FiberID))
		}
	}
	return strings.Join(parts, " + ")
}

// CauseError adapts a cause to Go's error interface at the edge of the
// runtime, for example in Run.
type CauseError struct {
	Cause *Cause
}

func (e *CauseError) Error() string { return e.Cause.String() }

// Unwrap exposes the typed failures to errors.Is and errors.As.
func (e *CauseError) Unwrap() []error { return e.Cause.Failures() }

// Exit is the result of running an effect: a value or a cause.
type Exit[A any] struct {
	value A
	cause *Cause
}

// ExitSucceed is a successful exit.
func ExitSucceed[A any](value A) Exit[A] { return Exit[A]{value: value} }

// ExitFailCause is a failed exit.
func ExitFailCause[A any](cause *Cause) Exit[A] { return Exit[A]{cause: cause} }

// IsSuccess reports whether the effect succeeded.
func (e Exit[A]) IsSuccess() bool { return e.cause == nil }

// Value returns the success value, if any.
func (e Exit[A]) Value() (A, bool) { return e.value, e.cause == nil }

// Cause returns the failure cause, or nil on success.
func (e Exit[A]) Cause() *Cause { return e.cause }

// Err returns nil on success, the typed failure when the cause is a single
// failure, and a *CauseError otherwise.
func (e Exit[A]) Err() error {
	if e.cause == nil {
		return nil
	}
	if reasons := e.cause.Reasons(); len(reasons) == 1 && reasons[0].Kind == ReasonFail {
		return reasons[0].Err
	}
	return &CauseError{Cause: e.cause}
}

func (e Exit[A]) String() string {
	if e.cause == nil {
		return fmt.Sprintf("Success(%v)", e.value)
	}
	return fmt.Sprintf("Failure(%v)", e.cause)
}

// ExitAny is an exit whose value type has been erased, as finalizers see it.
type ExitAny struct {
	Value any
	Cause *Cause
}

// IsSuccess reports whether the effect succeeded.
func (e ExitAny) IsSuccess() bool { return e.Cause == nil }

// TimeoutError is Effect's Cause.TimeoutError, raised by Timeout.
type TimeoutError struct{}

func (TimeoutError) Error() string { return "TimeoutError" }

// Tag is the error's tag, used by CatchTag.
func (TimeoutError) Tag() string { return "TimeoutError" }

// Tagged is implemented by tagged errors, which Forma generates for every
// `error` declaration.
type Tagged interface {
	error
	Tag() string
}
