package effect

import "sync"

// Scope collects finalizers and runs them, in reverse order of addition,
// when it closes.
type Scope struct {
	mu         sync.Mutex
	finalizers []func(ExitAny) node
	closed     bool
	exit       ExitAny
}

// ScopeTag is the Scope service: Forma's `Scope` requirement.
var ScopeTag = NewTag[*Scope]("Scope")

// NewScope makes an open scope.
func NewScope() *Scope { return &Scope{} }

func (s *Scope) add(finalizer func(ExitAny) node) (closedExit ExitAny, closed bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return s.exit, true
	}
	s.finalizers = append(s.finalizers, finalizer)
	return ExitAny{}, false
}

// AddFinalizer adds a finalizer. Adding to a closed scope runs it at once.
func (s *Scope) AddFinalizer(finalizer func(ExitAny) Effect[Unit]) Effect[Unit] {
	return wrap[Unit](&opSuspend{thunk: func() node {
		fin := func(exit ExitAny) node { return finalizer(exit).node }
		if exit, closed := s.add(fin); closed {
			return fin(exit)
		}
		return unitNode
	}})
}

// Close runs the finalizers in reverse order, uninterruptibly, and fails
// with their combined causes if any fail. Every finalizer runs.
func (s *Scope) Close(exit ExitAny) Effect[Unit] {
	return wrap[Unit](&opSetInterruptible{flag: false, body: s.closeNode(exit)})
}

func (s *Scope) closeNode(exit ExitAny) node {
	return &opGen{body: func(f *Fiber) any {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return Unit{}
		}
		s.closed, s.exit = true, exit
		finalizers := s.finalizers
		s.finalizers = nil
		s.mu.Unlock()
		var failures *Cause
		for i := len(finalizers) - 1; i >= 0; i-- {
			if _, cause := f.runLoop(callExit(f, finalizers[i], exit)); cause != nil {
				failures = failures.Combine(cause)
			}
		}
		if failures != nil {
			panic(&failSignal{fiber: f, cause: failures})
		}
		return Unit{}
	}}
}

// Scoped runs e with a fresh Scope service and closes the scope when e
// exits, passing e's exit to the finalizers.
func Scoped[A any](e Effect[A]) Effect[A] {
	return wrap[A](&opSuspend{thunk: func() node {
		scope := NewScope()
		return &opOnExit{
			first:  ProvideService(e, ScopeTag, scope).node,
			onExit: func(exit ExitAny) node { return scope.closeNode(exit) },
		}
	}})
}

// AcquireRelease acquires a resource uninterruptibly and adds its release
// to the current Scope. Release runs with the services that were current at
// acquisition, as in Effect.
func AcquireRelease[A any](acquire Effect[A], release func(A, ExitAny) Effect[Unit]) Effect[A] {
	return wrap[A](&opSetInterruptible{flag: false, body: &opWithFiber{f: func(f *Fiber) node {
		scope := ScopeTag.Get(f)
		services := currentContext.GetIn(f)
		return &opFlatMap{first: acquire.node, k: func(value any) node {
			resource := as[A](value)
			scope.add(func(exit ExitAny) node {
				return &opLocally{key: currentContext.key, value: services, body: release(resource, exit).node}
			})
			return &opSucceed{value: value}
		}}
	}}})
}

// AddFinalizer adds a finalizer to the current Scope.
func AddFinalizer(finalizer func(ExitAny) Effect[Unit]) Effect[Unit] {
	return wrap[Unit](&opWithFiber{f: func(f *Fiber) node {
		return ScopeTag.Get(f).AddFinalizer(finalizer).node
	}})
}

// AcquireUseRelease acquires, uses, and releases a resource without a
// Scope. Use is interruptible; acquire and release are not.
func AcquireUseRelease[A, B any](acquire Effect[A], use func(A) Effect[B], release func(A, ExitAny) Effect[Unit]) Effect[B] {
	return UninterruptibleMask(func(restore Restore) Effect[B] {
		return FlatMap(acquire, func(a A) Effect[B] {
			return wrap[B](&opOnExit{
				first:  Restored(restore, Suspend(func() Effect[B] { return use(a) })).node,
				onExit: func(exit ExitAny) node { return release(a, exit).node },
			})
		})
	})
}
