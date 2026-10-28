package effect

import (
	"encoding/json"
	"errors"
	"fmt"
)

// Effect describes a computation that succeeds with an A, fails with a
// cause, or is interrupted. It is a value: running it twice runs it twice.
//
// Go types carry only the success type. Effect's error channel E is an
// error value inside a Cause and its requirement channel R is the fiber's
// Context; Forma's checker proves both closed before generating Go.
type Effect[A any] struct {
	node node
}

// Unit is the success type of effects run for their effect.
type Unit = struct{}

// node is an untyped opcode. The typed API wraps and unwraps values so the
// interpreter can stay monomorphic.
type node interface{}

type (
	opSucceed struct{ value any }
	opFailure struct{ cause *Cause }
	opSuspend struct{ thunk func() node }
	opFlatMap struct {
		first node
		k     func(any) node
	}
	// opMatch handles failure, success, or both; nil handlers pass through.
	opMatch struct {
		first     node
		onFailure func(*Cause) node
		onSuccess func(any) node
	}
	// opOnExit runs a finalizer, uninterruptibly, however first exits.
	opOnExit struct {
		first  node
		onExit func(ExitAny) node
	}
	opWithFiber        struct{ f func(*Fiber) node }
	opSetInterruptible struct {
		flag bool
		body node
	}
	opLocally struct {
		key   *refKey
		value any
		body  node
	}
	// opGen runs a direct-style body on the fiber's goroutine.
	opGen struct{ body func(*Fiber) any }
	// opBlock parks the fiber's goroutine; run decides how interruption wakes it.
	opBlock struct{ run func(*Fiber) (any, *Cause) }
)

// The hot opcodes are generic structs that implement small interfaces, so
// the typed API needs no wrapper closure per operation.
type (
	// continuation resumes a stack frame with a success value.
	continuation interface{ resume(any) node }
	// flatMapper pushes itself as the continuation of its first effect.
	flatMapper interface {
		continuation
		firstNode() node
	}
	// mapper is a continuation that produces a value, not an effect.
	mapper interface {
		firstNode() node
		mapValue(any) any
	}
	syncer interface{ runSync() any }
	genner interface{ runBody(*Fiber) any }
)

type flatMapOp[A, B any] struct {
	first node
	f     func(A) Effect[B]
}

func (o *flatMapOp[A, B]) firstNode() node       { return o.first }
func (o *flatMapOp[A, B]) resume(value any) node { return o.f(as[A](value)).node }

type mapOp[A, B any] struct {
	first node
	f     func(A) B
}

func (o *mapOp[A, B]) firstNode() node        { return o.first }
func (o *mapOp[A, B]) mapValue(value any) any { return o.f(as[A](value)) }

type syncOp[A any] struct{ thunk func() A }

func (o *syncOp[A]) runSync() any { return o.thunk() }

type genOp[A any] struct{ body func(*Fiber) A }

func (o *genOp[A]) runBody(f *Fiber) any { return o.body(f) }

func (o *opGen) runBody(f *Fiber) any { return o.body(f) }

func (o *opFlatMap) firstNode() node       { return o.first }
func (o *opFlatMap) resume(value any) node { return o.k(value) }

// contFunc adapts an untyped success handler to a continuation.
type contFunc func(any) node

func (k contFunc) resume(value any) node { return k(value) }

func wrap[A any](n node) Effect[A] { return Effect[A]{node: n} }

// as converts an interpreter value back to its static type. Nil interface
// values of interface types round-trip as the zero value.
func as[A any](value any) A {
	if value == nil {
		var zero A
		return zero
	}
	return value.(A)
}

var unitNode node = &opSucceed{value: Unit{}}

// Void succeeds with Unit.
var Void = wrap[Unit](unitNode)

// Succeed succeeds with a.
func Succeed[A any](a A) Effect[A] { return wrap[A](&opSucceed{value: a}) }

// Fail fails with a typed error.
func Fail[A any](err error) Effect[A] { return wrap[A](&opFailure{cause: FailCause(err)}) }

// FailWithCause fails with an existing cause.
func FailWithCause[A any](cause *Cause) Effect[A] { return wrap[A](&opFailure{cause: cause}) }

// Die fails with a defect.
func Die[A any](defect any) Effect[A] { return wrap[A](&opFailure{cause: DieCause(defect)}) }

// Sync runs a side-effecting function. A panic becomes a defect.
func Sync[A any](thunk func() A) Effect[A] {
	return wrap[A](&syncOp[A]{thunk: thunk})
}

// Suspend builds the effect lazily, each time it runs.
func Suspend[A any](thunk func() Effect[A]) Effect[A] {
	return wrap[A](&opSuspend{thunk: func() node { return thunk().node }})
}

// FlatMap sequences f after e.
func FlatMap[A, B any](e Effect[A], f func(A) Effect[B]) Effect[B] {
	return wrap[B](&flatMapOp[A, B]{first: e.node, f: f})
}

// Map transforms the success value.
func Map[A, B any](e Effect[A], f func(A) B) Effect[B] {
	return wrap[B](&mapOp[A, B]{first: e.node, f: f})
}

// As replaces the success value.
func As[A, B any](e Effect[A], b B) Effect[B] {
	return wrap[B](&opFlatMap{first: e.node, k: func(any) node { return &opSucceed{value: b} }})
}

// AndThen runs b after a and keeps b's value.
func AndThen[A, B any](a Effect[A], b Effect[B]) Effect[B] {
	return wrap[B](&opFlatMap{first: a.node, k: func(any) node { return b.node }})
}

// Tap runs f for its effect and keeps e's value.
func Tap[A, B any](e Effect[A], f func(A) Effect[B]) Effect[A] {
	return wrap[A](&opFlatMap{first: e.node, k: func(v any) node {
		return &opFlatMap{first: f(as[A](v)).node, k: func(any) node { return &opSucceed{value: v} }}
	}})
}

// MatchCause handles both outcomes. It sees interruptions only while the
// fiber is uninterruptible, as in Effect.
func MatchCause[A, B any](e Effect[A], onFailure func(*Cause) Effect[B], onSuccess func(A) Effect[B]) Effect[B] {
	return wrap[B](&opMatch{
		first:     e.node,
		onFailure: func(c *Cause) node { return onFailure(c).node },
		onSuccess: func(v any) node { return onSuccess(as[A](v)).node },
	})
}

// CatchCause recovers from any cause the fiber can observe.
func CatchCause[A any](e Effect[A], handler func(*Cause) Effect[A]) Effect[A] {
	return wrap[A](&opMatch{first: e.node, onFailure: func(c *Cause) node { return handler(c).node }})
}

// Catch recovers from the first typed failure, as Effect.catch does.
// Defects and interruptions pass through.
func Catch[A any](e Effect[A], handler func(error) Effect[A]) Effect[A] {
	return wrap[A](&opMatch{first: e.node, onFailure: func(c *Cause) node {
		if err, ok := c.Failure(); ok {
			return handler(err).node
		}
		return &opFailure{cause: c}
	}})
}

// CatchTag recovers from failures of the error type E, which Go infers from
// the handler: CatchTag(eff, func(e UserNotFound) Effect[A] {...}). It is
// Effect.catchTag with errors.As in place of the tag comparison.
func CatchTag[A any, E error](e Effect[A], handler func(E) Effect[A]) Effect[A] {
	return wrap[A](&opMatch{first: e.node, onFailure: func(c *Cause) node {
		if err, ok := c.Failure(); ok {
			var target E
			if errors.As(err, &target) {
				return handler(target).node
			}
		}
		return &opFailure{cause: c}
	}})
}

// MapError transforms typed failures.
func MapError[A any](e Effect[A], f func(error) error) Effect[A] {
	return wrap[A](&opMatch{first: e.node, onFailure: func(c *Cause) node {
		reasons := make([]Reason, len(c.Reasons()))
		for i, reason := range c.Reasons() {
			if reason.Kind == ReasonFail {
				reason.Err = f(reason.Err)
			}
			reasons[i] = reason
		}
		return &opFailure{cause: &Cause{reasons: reasons}}
	}})
}

// OrElseSucceed replaces a typed failure with a value.
func OrElseSucceed[A any](e Effect[A], fallback func() A) Effect[A] {
	return Catch(e, func(error) Effect[A] { return Sync(fallback) })
}

// OrDie turns typed failures into defects.
func OrDie[A any](e Effect[A]) Effect[A] {
	return wrap[A](&opMatch{first: e.node, onFailure: func(c *Cause) node {
		reasons := make([]Reason, len(c.Reasons()))
		for i, reason := range c.Reasons() {
			if reason.Kind == ReasonFail {
				reason = Reason{Kind: ReasonDie, Defect: reason.Err}
			}
			reasons[i] = reason
		}
		return &opFailure{cause: &Cause{reasons: reasons}}
	}})
}

// ToOption turns a typed failure into None.
func ToOption[A any](e Effect[A]) Effect[Option[A]] {
	return MatchCause(e,
		func(c *Cause) Effect[Option[A]] {
			if c.IsFailureOnly() {
				return Succeed(None[A]())
			}
			return FailWithCause[Option[A]](c)
		},
		func(a A) Effect[Option[A]] { return Succeed(Some(a)) })
}

// ToResult reifies a typed failure as data.
func ToResult[A any](e Effect[A]) Effect[Result[A]] {
	return MatchCause(e,
		func(c *Cause) Effect[Result[A]] {
			if err, ok := c.Failure(); ok && c.IsFailureOnly() {
				return Succeed(Failure[A](err))
			}
			return FailWithCause[Result[A]](c)
		},
		func(a A) Effect[Result[A]] { return Succeed(Success(a)) })
}

// Flip swaps the typed failure and the success value.
func Flip[A any](e Effect[A]) Effect[error] {
	return MatchCause(e,
		func(c *Cause) Effect[error] {
			if err, ok := c.Failure(); ok && c.IsFailureOnly() {
				return Succeed(err)
			}
			return FailWithCause[error](c)
		},
		func(a A) Effect[error] { return Die[error](fmt.Sprintf("Flip: effect succeeded with %v", a)) })
}

// ToExit reifies the outcome. Like Effect.exit it cannot observe the
// interruption of its own fiber while that fiber is interruptible.
func ToExit[A any](e Effect[A]) Effect[Exit[A]] {
	return MatchCause(e,
		func(c *Cause) Effect[Exit[A]] { return Succeed(ExitFailCause[A](c)) },
		func(a A) Effect[Exit[A]] { return Succeed(ExitSucceed(a)) })
}

// OnExit runs finalizer after e however it exits. The finalizer runs
// uninterruptibly; its failure is added to e's cause.
func OnExit[A any](e Effect[A], finalizer func(Exit[A]) Effect[Unit]) Effect[A] {
	return wrap[A](&opOnExit{first: e.node, onExit: func(exit ExitAny) node {
		if exit.Cause != nil {
			return finalizer(ExitFailCause[A](exit.Cause)).node
		}
		return finalizer(ExitSucceed(as[A](exit.Value))).node
	}})
}

// Ensuring runs finalizer after e however it exits.
func Ensuring[A any](e Effect[A], finalizer Effect[Unit]) Effect[A] {
	return wrap[A](&opOnExit{first: e.node, onExit: func(ExitAny) node { return finalizer.node }})
}

// OnInterrupt runs finalizer only when e is interrupted.
func OnInterrupt[A any](e Effect[A], finalizer Effect[Unit]) Effect[A] {
	return wrap[A](&opOnExit{first: e.node, onExit: func(exit ExitAny) node {
		if exit.Cause.IsInterrupted() {
			return finalizer.node
		}
		return unitNode
	}})
}

// Uninterruptible runs e with interruption deferred until it completes.
func Uninterruptible[A any](e Effect[A]) Effect[A] {
	return wrap[A](&opSetInterruptible{flag: false, body: e.node})
}

// Interruptible makes e interruptible inside an uninterruptible region.
func Interruptible[A any](e Effect[A]) Effect[A] {
	return wrap[A](&opSetInterruptible{flag: true, body: e.node})
}

// Restore re-enables the interruptibility that UninterruptibleMask
// disabled. Go has no generic methods or rank-2 function values, so Effect's
// `restore` callback becomes this token plus the generic function Restored.
type Restore struct{ interruptible bool }

// Restored applies a Restore to an effect of any type.
func Restored[A any](r Restore, e Effect[A]) Effect[A] {
	if !r.interruptible {
		return e
	}
	return Interruptible(e)
}

// UninterruptibleMask runs f uninterruptibly; f can restore the previous
// interruptibility for parts of its body.
func UninterruptibleMask[A any](f func(Restore) Effect[A]) Effect[A] {
	return wrap[A](&opWithFiber{f: func(fiber *Fiber) node {
		restore := Restore{interruptible: fiber.interruptible}
		return &opSetInterruptible{flag: false, body: f(restore).node}
	}})
}

// Interrupt fails with an interruption by the current fiber. As in Effect 4
// it is an ordinary failure cause: it does not mark the fiber interrupted.
func Interrupt[A any]() Effect[A] {
	return wrap[A](&opWithFiber{f: func(fiber *Fiber) node {
		return &opFailure{cause: InterruptCause(fiber.id)}
	}})
}

// Never blocks until the fiber is interrupted.
func Never[A any]() Effect[A] {
	return wrap[A](&opBlock{run: func(f *Fiber) (any, *Cause) {
		if !f.interruptible {
			select {}
		}
		<-f.interruptCh
		return nil, f.deliverInterrupt()
	}})
}

// FiberID succeeds with the current fiber's id.
var FiberID = wrap[uint64](&opWithFiber{f: func(f *Fiber) node { return &opSucceed{value: f.id} }})

// Option is an optional value.
type Option[A any] struct {
	value A
	ok    bool
}

// Some is a present value.
func Some[A any](a A) Option[A] { return Option[A]{value: a, ok: true} }

// None is an absent value.
func None[A any]() Option[A] { return Option[A]{} }

// Get returns the value and whether it is present.
func (o Option[A]) Get() (A, bool) { return o.value, o.ok }

// IsSome reports whether the value is present.
func (o Option[A]) IsSome() bool { return o.ok }

// IsNone reports whether the value is absent.
func (o Option[A]) IsNone() bool { return !o.ok }

// GetOrElse returns the value or a fallback.
func (o Option[A]) GetOrElse(fallback A) A {
	if o.ok {
		return o.value
	}
	return fallback
}

func (o Option[A]) String() string {
	if o.ok {
		return fmt.Sprintf("Some(%v)", o.value)
	}
	return "None"
}

// Result is a success value or a typed failure, reified as data.
type Result[A any] struct {
	value A
	err   error
}

// Success is a successful result.
func Success[A any](a A) Result[A] { return Result[A]{value: a} }

// Failure is a failed result.
func Failure[A any](err error) Result[A] { return Result[A]{err: err} }

// Get returns the value, or the failure.
func (r Result[A]) Get() (A, error) { return r.value, r.err }

// IsSuccess reports whether the result succeeded.
func (r Result[A]) IsSuccess() bool { return r.err == nil }

// Tuple2 is a pair, used for Forma tuples and All2.
type Tuple2[A, B any] struct {
	V1 A
	V2 B
}

// Tuple3 is a triple.
type Tuple3[A, B, C any] struct {
	V1 A
	V2 B
	V3 C
}

// IsZero reports absence, so an optional struct field tagged `omitzero` is
// left out of JSON, as Forma's wire encoding requires.
func (o Option[A]) IsZero() bool { return !o.ok }

// MarshalJSON encodes the value, or null when absent.
func (o Option[A]) MarshalJSON() ([]byte, error) {
	if !o.ok {
		return []byte("null"), nil
	}
	return json.Marshal(o.value)
}

// UnmarshalJSON decodes a present value; null is absent.
func (o *Option[A]) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*o = None[A]()
		return nil
	}
	var value A
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*o = Some(value)
	return nil
}
