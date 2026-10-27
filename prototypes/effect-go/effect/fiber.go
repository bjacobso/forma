package effect

import (
	"context"
	"fmt"
	"runtime/debug"
	"sync"
	"sync/atomic"
)

// Fiber is one goroutine running an effect. Go schedules and preempts it;
// the runtime adds interruption, supervision, and fiber-local state.
//
// Most fields belong to the fiber's own goroutine. Other goroutines only
// interrupt it, add or remove children, and wait for it.
type Fiber struct {
	id     uint64
	parent *Fiber

	// Owned by the fiber's goroutine.
	interruptible bool
	// delivered is set once an interruption has been turned into a failure
	// in the current interruptible region, so it is not delivered twice.
	delivered  bool
	refs       map[*refKey]any
	refsShared bool

	// Written once by any goroutine.
	interrupted atomic.Pointer[Cause]
	interruptCh chan struct{}

	mu       sync.Mutex
	children map[*Fiber]struct{}
	closed   bool
	goCtx    context.Context
	cancel   context.CancelCauseFunc
	// observers are called once the fiber has completed.
	observers []func(*Fiber)
	finished  bool

	done  chan struct{}
	value any
	cause *Cause
}

var nextFiberID atomic.Uint64

func newFiber(parent *Fiber, refs map[*refKey]any, goCtx context.Context) *Fiber {
	return &Fiber{
		id:            nextFiberID.Add(1),
		parent:        parent,
		interruptible: true,
		refs:          refs,
		refsShared:    true,
		interruptCh:   make(chan struct{}),
		done:          make(chan struct{}),
		goCtx:         goCtx,
	}
}

// ID is the fiber's identifier, used in interruption causes.
func (f *Fiber) ID() uint64 { return f.id }

// interruptAs requests interruption. The fiber sees it at its next
// interruption point while interruptible, or immediately if it is parked.
func (f *Fiber) interruptAs(by uint64) {
	if !f.interrupted.CompareAndSwap(nil, InterruptCause(by)) {
		return
	}
	close(f.interruptCh)
	f.mu.Lock()
	cancel := f.cancel
	f.mu.Unlock()
	if cancel != nil {
		cancel(errInterrupted)
	}
}

var errInterrupted = fmt.Errorf("effect: fiber interrupted")

func (f *Fiber) isInterrupted() bool { return f.interrupted.Load() != nil }

// deliverInterrupt returns the interruption cause and records that it has
// been delivered in the current interruptible region.
func (f *Fiber) deliverInterrupt() *Cause {
	f.delivered = true
	return f.interrupted.Load()
}

// Context is a context.Context cancelled when the fiber is interrupted. It
// is how interruption reaches blocking Go calls; see Blocking.
func (f *Fiber) Context() context.Context {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.cancel == nil {
		parent := f.goCtx
		if parent == nil {
			parent = context.Background()
		}
		f.goCtx, f.cancel = context.WithCancelCause(parent)
		if f.isInterrupted() {
			f.cancel(errInterrupted)
		}
	}
	return f.goCtx
}

// frame is a continuation on a run loop's stack. Rare fields live behind
// extra to keep frames small.
type frame struct {
	kind      frameKind
	flag      bool
	k         continuation
	m         mapper
	onFailure func(*Cause) node
	onExit    func(ExitAny) node
	extra     *frameExtra
}

type frameExtra struct {
	key     *refKey
	prev    any
	hadPrev bool
	exit    ExitAny
}

type frameKind uint8

const (
	frameFlatMap frameKind = iota
	frameMap
	frameMatch
	frameOnExit
	frameSetInterruptible
	frameLocally
	// frameRestoreExit resumes the original exit after a finalizer.
	frameRestoreExit
)

// runLoop interprets an effect on the current goroutine until it exits.
// Await calls it re-entrantly, so each call owns its own stack.
//
// Interruption follows Effect 4: it is delivered at the next operation
// while the fiber is interruptible; while it propagates, recovery handlers
// are skipped, finalizers run uninterruptibly, and leaving an
// uninterruptible region re-delivers it.
func (f *Fiber) runLoop(start node) (any, *Cause) {
	var stack []frame
	cur := start
	for {
		if f.interruptible && !f.delivered && f.isInterrupted() {
			cur = &opFailure{cause: f.deliverInterrupt()}
		}
		var value any
		var cause *Cause
		switch op := cur.(type) {
		case *opSucceed:
			value = op.value
		case *opFailure:
			cause = op.cause
		case flatMapper:
			stack = append(stack, frame{kind: frameFlatMap, k: op})
			cur = op.firstNode()
			continue
		case mapper:
			stack = append(stack, frame{kind: frameMap, m: op})
			cur = op.firstNode()
			continue
		case syncer:
			value, cause = callSync(f, op)
		case *opSuspend:
			cur = callThunk(f, op.thunk)
			continue
		case *opMatch:
			fr := frame{kind: frameMatch, onFailure: op.onFailure}
			if op.onSuccess != nil {
				fr.k = contFunc(op.onSuccess)
			}
			stack = append(stack, fr)
			cur = op.first
			continue
		case *opOnExit:
			stack = append(stack, frame{kind: frameOnExit, onExit: op.onExit})
			cur = op.first
			continue
		case *opWithFiber:
			cur = callWithFiber(f, op.f)
			continue
		case *opSetInterruptible:
			if f.interruptible != op.flag {
				stack = append(stack, frame{kind: frameSetInterruptible, flag: f.interruptible})
				f.interruptible = op.flag
				if op.flag {
					f.delivered = false
				}
			}
			cur = op.body
			continue
		case *opLocally:
			prev, had := f.refs[op.key]
			stack = append(stack, frame{kind: frameLocally, extra: &frameExtra{key: op.key, prev: prev, hadPrev: had}})
			f.setRef(op.key, op.value)
			cur = op.body
			continue
		case genner:
			value, cause = f.runGen(op)
		case *opBlock:
			value, cause = callBlock(f, op.run)
		case nil:
			cause = DieCause("effect: nil effect (zero Effect value)")
		default:
			cause = DieCause(fmt.Sprintf("effect: unknown opcode %T", cur))
		}

		// Pop frames until one continues with a new effect.
		cur = nil
		for cur == nil {
			if len(stack) == 0 {
				return value, cause
			}
			fr := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			switch fr.kind {
			case frameFlatMap:
				if cause == nil {
					cur = callK(f, fr.k, value)
				}
			case frameMap:
				if cause == nil {
					value, cause = callMap(f, fr.m, value)
				}
			case frameMatch:
				if cause == nil {
					if fr.k != nil {
						cur = callK(f, fr.k, value)
					}
				} else if f.interruptible && f.isInterrupted() {
					// Interruption skips recovery and drops typed failures.
					cause = cause.withoutFailures().Combine(f.interrupted.Load())
					f.delivered = true
				} else if fr.onFailure != nil {
					cur = callFailure(f, fr.onFailure, cause)
				}
			case frameOnExit:
				if f.interruptible {
					stack = append(stack, frame{kind: frameSetInterruptible, flag: true})
					f.interruptible = false
				}
				exit := ExitAny{Value: value, Cause: cause}
				stack = append(stack, frame{kind: frameRestoreExit, extra: &frameExtra{exit: exit}})
				cur = callExit(f, fr.onExit, exit)
			case frameRestoreExit:
				// The finalizer finished: resume the original exit, adding
				// the finalizer's own failure.
				if exit := fr.extra.exit; cause != nil && exit.Cause != nil {
					cause = exit.Cause.Combine(cause)
				} else if cause == nil {
					value, cause = exit.Value, exit.Cause
				}
			case frameSetInterruptible:
				f.interruptible = fr.flag
				if fr.flag && f.isInterrupted() {
					f.delivered = true
					if cause == nil {
						value, cause = nil, f.interrupted.Load()
					} else {
						cause = cause.Combine(f.interrupted.Load())
					}
				}
			case frameLocally:
				if extra := fr.extra; extra.hadPrev {
					f.setRef(extra.key, extra.prev)
				} else {
					f.deleteRef(extra.key)
				}
			}
		}
	}
}

// Calls into user code recover panics as defects. A failSignal panic is an
// Await inside the callback, which carries an ordinary failure.

func recovered(f *Fiber, r any) *Cause {
	if signal, ok := r.(*failSignal); ok && signal.fiber == f {
		return signal.cause
	}
	return &Cause{reasons: []Reason{{Kind: ReasonDie, Defect: r, Stack: string(debug.Stack())}}}
}

func callSync(f *Fiber, op syncer) (value any, cause *Cause) {
	defer func() {
		if r := recover(); r != nil {
			value, cause = nil, recovered(f, r)
		}
	}()
	return op.runSync(), nil
}

func callMap(f *Fiber, m mapper, in any) (value any, cause *Cause) {
	defer func() {
		if r := recover(); r != nil {
			value, cause = nil, recovered(f, r)
		}
	}()
	return m.mapValue(in), nil
}

func callThunk(f *Fiber, thunk func() node) (n node) {
	defer func() {
		if r := recover(); r != nil {
			n = &opFailure{cause: recovered(f, r)}
		}
	}()
	return thunk()
}

func callWithFiber(f *Fiber, k func(*Fiber) node) (n node) {
	defer func() {
		if r := recover(); r != nil {
			n = &opFailure{cause: recovered(f, r)}
		}
	}()
	return k(f)
}

func callK(f *Fiber, k continuation, value any) (n node) {
	defer func() {
		if r := recover(); r != nil {
			n = &opFailure{cause: recovered(f, r)}
		}
	}()
	return k.resume(value)
}

func callFailure(f *Fiber, k func(*Cause) node, cause *Cause) (n node) {
	defer func() {
		if r := recover(); r != nil {
			n = &opFailure{cause: recovered(f, r)}
		}
	}()
	return k(cause)
}

func callExit(f *Fiber, k func(ExitAny) node, exit ExitAny) (n node) {
	defer func() {
		if r := recover(); r != nil {
			n = &opFailure{cause: recovered(f, r)}
		}
	}()
	if n = k(exit); n == nil {
		n = unitNode
	}
	return n
}

func callBlock(f *Fiber, run func(*Fiber) (any, *Cause)) (value any, cause *Cause) {
	defer func() {
		if r := recover(); r != nil {
			value, cause = nil, recovered(f, r)
		}
	}()
	return run(f)
}

// failSignal carries a failure out of a direct-style body. Await panics
// with it and the enclosing Gen recovers it, so a failing Await abandons
// the rest of the body the way a failing `yield*` abandons a generator.
// Deferred calls in the body run, as `finally` blocks do.
type failSignal struct {
	fiber *Fiber
	cause *Cause
}

func (f *Fiber) runGen(op genner) (value any, cause *Cause) {
	defer func() {
		if r := recover(); r != nil {
			value, cause = nil, recovered(f, r)
		}
	}()
	return op.runBody(f), nil
}

// Gen is Effect.gen without generators: body runs on the fiber's goroutine
// and binds sub-effects with Await. Go has no goroutine-local storage, so
// the fiber is passed explicitly.
func Gen[A any](body func(f *Fiber) A) Effect[A] {
	return wrap[A](&genOp[A]{body: body})
}

// Await runs e on f's goroutine and returns its value. Every Await is an
// interruption point. On failure it unwinds the enclosing Gen body, whose
// effect fails with the same cause.
//
// f must be the fiber running the enclosing Gen; generated code always
// passes the innermost one.
func Await[A any](f *Fiber, e Effect[A]) A {
	if f.interruptible && f.isInterrupted() {
		panic(&failSignal{fiber: f, cause: f.deliverInterrupt()})
	}
	value, cause := f.runLoop(e.node)
	if cause != nil {
		panic(&failSignal{fiber: f, cause: cause})
	}
	return as[A](value)
}

// Try is Await for hand-written Go: typed failures are returned as an
// error. Defects and interruptions still unwind the body, because Effect
// does not let a generator resume after them.
func Try[A any](f *Fiber, e Effect[A]) (A, error) {
	if f.interruptible && f.isInterrupted() {
		panic(&failSignal{fiber: f, cause: f.deliverInterrupt()})
	}
	value, cause := f.runLoop(e.node)
	if cause == nil {
		return as[A](value), nil
	}
	if err, ok := cause.Failure(); ok && cause.IsFailureOnly() {
		var zero A
		return zero, err
	}
	panic(&failSignal{fiber: f, cause: cause})
}

// start runs a forked fiber to completion on its own goroutine.
func (f *Fiber) start(n node) {
	value, cause := f.runProtected(n)
	f.complete(value, cause)
}

// runProtected is the recover boundary every fiber has: an unrecovered
// panic on a goroutine kills the process, so one that escapes the run loop
// (a runtime bug) still becomes a defect.
func (f *Fiber) runProtected(n node) (value any, cause *Cause) {
	defer func() {
		if r := recover(); r != nil {
			value, cause = nil, recovered(nil, r)
		}
	}()
	return f.runLoop(n)
}

// complete interrupts the fiber's remaining children and waits for them
// (supervision), then publishes the exit.
func (f *Fiber) complete(value any, cause *Cause) {
	f.mu.Lock()
	f.closed = true
	children := make([]*Fiber, 0, len(f.children))
	for child := range f.children {
		children = append(children, child)
	}
	f.children = nil
	cancel := f.cancel
	f.mu.Unlock()
	for _, child := range children {
		child.interruptAs(f.id)
	}
	for _, child := range children {
		<-child.done
	}
	if cancel != nil {
		cancel(context.Canceled)
	}
	f.value, f.cause = value, cause
	if f.parent != nil {
		f.parent.removeChild(f)
	}
	close(f.done)
	f.mu.Lock()
	f.finished = true
	observers := f.observers
	f.observers = nil
	f.mu.Unlock()
	for _, observe := range observers {
		observe(f)
	}
}

// addObserver calls observe once the fiber has completed.
func (f *Fiber) addObserver(observe func(*Fiber)) {
	f.mu.Lock()
	if !f.finished {
		f.observers = append(f.observers, observe)
		f.mu.Unlock()
		return
	}
	f.mu.Unlock()
	observe(f)
}

func (f *Fiber) addChild(child *Fiber) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return false
	}
	if f.children == nil {
		f.children = make(map[*Fiber]struct{})
	}
	f.children[child] = struct{}{}
	return true
}

func (f *Fiber) removeChild(child *Fiber) {
	f.mu.Lock()
	delete(f.children, child)
	f.mu.Unlock()
}

// fork starts n on a new goroutine. A child fiber is supervised: it is
// interrupted when its parent completes, and the parent waits for it.
// A daemon fiber is not.
func (f *Fiber) fork(n node, daemon bool) *Fiber {
	f.refsShared = true
	parent, goCtx := f, f.goCtx
	if daemon {
		parent = nil
		if goCtx != nil {
			goCtx = context.WithoutCancel(goCtx)
		}
	}
	child := newFiber(parent, f.refs, goCtx)
	if !daemon && !f.addChild(child) {
		child.interruptAs(f.id)
	}
	go child.start(n)
	return child
}

// wait parks until ch is ready, or until interruption if the fiber is
// interruptible. It reports whether the fiber was interrupted.
func (f *Fiber) wait(ch <-chan struct{}) bool {
	if !f.interruptible {
		<-ch
		return false
	}
	select {
	case <-ch:
		return false
	case <-f.interruptCh:
		return true
	}
}

// awaitExit parks until child completes.
func (f *Fiber) awaitFiber(child *Fiber) (any, *Cause, bool) {
	if f.wait(child.done) {
		return nil, nil, true
	}
	return child.value, child.cause, false
}

// Handle is a forked fiber whose success type is A.
type Handle[A any] struct {
	fiber *Fiber
}

// ID is the forked fiber's id.
func (h *Handle[A]) ID() uint64 { return h.fiber.id }

// Await waits for the fiber and succeeds with its exit.
func (h *Handle[A]) Await() Effect[Exit[A]] {
	return wrap[Exit[A]](&opBlock{run: func(f *Fiber) (any, *Cause) {
		value, cause, interrupted := f.awaitFiber(h.fiber)
		if interrupted {
			return nil, f.deliverInterrupt()
		}
		return Exit[A]{value: as[A](value), cause: cause}, nil
	}})
}

// Join waits for the fiber and continues with its outcome.
func (h *Handle[A]) Join() Effect[A] {
	return wrap[A](&opBlock{run: func(f *Fiber) (any, *Cause) {
		value, cause, interrupted := f.awaitFiber(h.fiber)
		if interrupted {
			return nil, f.deliverInterrupt()
		}
		return value, cause
	}})
}

// Interrupt interrupts the fiber and waits for it to finish, including its
// finalizers and children.
func (h *Handle[A]) Interrupt() Effect[Exit[A]] {
	return wrap[Exit[A]](&opBlock{run: func(f *Fiber) (any, *Cause) {
		h.fiber.interruptAs(f.id)
		value, cause, interrupted := f.awaitFiber(h.fiber)
		if interrupted {
			return nil, f.deliverInterrupt()
		}
		return Exit[A]{value: as[A](value), cause: cause}, nil
	}})
}

// Poll returns the exit if the fiber has finished.
func (h *Handle[A]) Poll() (Exit[A], bool) {
	select {
	case <-h.fiber.done:
		return Exit[A]{value: as[A](h.fiber.value), cause: h.fiber.cause}, true
	default:
		return Exit[A]{}, false
	}
}

// Fork starts e in a child fiber supervised by the current one, as
// Effect.forkChild does.
func Fork[A any](e Effect[A]) Effect[*Handle[A]] {
	return wrap[*Handle[A]](&opWithFiber{f: func(f *Fiber) node {
		return &opSucceed{value: &Handle[A]{fiber: f.fork(e.node, false)}}
	}})
}

// ForkDaemon starts e in a fiber that outlives the current one.
func ForkDaemon[A any](e Effect[A]) Effect[*Handle[A]] {
	return wrap[*Handle[A]](&opWithFiber{f: func(f *Fiber) node {
		return &opSucceed{value: &Handle[A]{fiber: f.fork(e.node, true)}}
	}})
}

// RunExit runs e on the calling goroutine as a root fiber and returns its
// exit. Cancelling ctx interrupts the fiber.
func RunExit[A any](ctx context.Context, e Effect[A]) Exit[A] {
	root := newFiber(nil, nil, ctx)
	if ctx.Done() != nil {
		stop := context.AfterFunc(ctx, func() { root.interruptAs(0) })
		defer stop()
	}
	value, cause := root.runProtected(e.node)
	root.complete(value, cause)
	return Exit[A]{value: as[A](value), cause: cause}
}

// Run runs e and returns its value, or its failure as an error.
func Run[A any](ctx context.Context, e Effect[A]) (A, error) {
	exit := RunExit(ctx, e)
	return exit.value, exit.Err()
}

// RunFork starts e as a root fiber on a new goroutine.
func RunFork[A any](ctx context.Context, e Effect[A]) *Handle[A] {
	root := newFiber(nil, nil, ctx)
	if ctx.Done() != nil {
		context.AfterFunc(ctx, func() { root.interruptAs(0) })
	}
	go root.start(e.node)
	return &Handle[A]{fiber: root}
}

// Wait blocks the calling goroutine (outside any fiber) until the fiber
// finishes.
func (h *Handle[A]) Wait() Exit[A] {
	<-h.fiber.done
	return Exit[A]{value: as[A](h.fiber.value), cause: h.fiber.cause}
}

// InterruptAndWait interrupts the fiber from outside the runtime.
func (h *Handle[A]) InterruptAndWait() Exit[A] {
	h.fiber.interruptAs(0)
	return h.Wait()
}
