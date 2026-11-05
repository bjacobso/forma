package effect

import (
	"errors"
	"testing"
	"time"
)

// Direct ports of tests from Effect 4's suite, packages/effect/test/Effect.test.ts
// in Effect-TS/effect at commit 1e732194015849141011e685edef968410568617.
// Test names are Effect's. Effect forks with { startImmediately: true } so
// the child is parked before the parent interrupts it; these ports wait on a
// started latch instead.

// "skipped handlers drop failures and keep defects when interrupted"
func TestEffect4SkippedHandlersDropFailuresAndKeepDefects(t *testing.T) {
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		latch := Await(f, MakeDeferred[Unit]())
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			failure := FailWithCause[Unit](FailCause(errBoom).Combine(DieCause("defect")))
			return CatchCause(Uninterruptible(AndThen(signal(started), AndThen(latch.Await(), failure))),
				func(*Cause) Effect[Unit] { return Void })
		})
		h.fiber.interruptAs(123)
		Await(f, signal(latch))
		return Await(f, h.Await())
	}))
	cause := exit.Cause()
	if len(cause.Failures()) != 0 || len(cause.Defects()) != 1 || !cause.interruptedBy(123) {
		t.Fatalf("cause = %v", cause)
	}
}

// "uninterruptible handlers observe the interruption after skipped handlers"
func TestEffect4UninterruptibleHandlersObserveTheInterruption(t *testing.T) {
	var result Exit[Unit]
	mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		latch := Await(f, MakeDeferred[Unit]())
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			inner := Catch(Uninterruptible(AndThen(signal(started), AndThen(latch.Await(), Fail[Unit](errBoom)))),
				func(error) Effect[Unit] { return Void })
			return Uninterruptible(Map(ToExit(Interruptible(inner)), func(exit Exit[Unit]) Unit {
				result = exit
				return Unit{}
			}))
		})
		h.fiber.interruptAs(123)
		Await(f, signal(latch))
		return Await(f, h.Await())
	}))
	if result.IsSuccess() || !result.Cause().IsInterruptedOnly() {
		t.Fatalf("result = %v", result)
	}
}

// "handlers inside an uninterruptible region recover with interruption pending"
func TestEffect4HandlersInsideUninterruptibleRegionRecover(t *testing.T) {
	recovered := false
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		latch := Await(f, MakeDeferred[Unit]())
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return Uninterruptible(Catch(AndThen(signal(started), AndThen(latch.Await(), Fail[Unit](errBoom))),
				func(error) Effect[Unit] { return Sync(func() Unit { recovered = true; return Unit{} }) }))
		})
		h.fiber.interruptAs(123)
		Await(f, signal(latch))
		return Await(f, h.Await())
	}))
	if !recovered || !exit.Cause().IsInterrupted() {
		t.Fatalf("recovered %v, exit %v", recovered, exit)
	}
}

// "sync forever is interruptible"
func TestEffect4SyncForeverIsInterruptible(t *testing.T) {
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		h := Await(f, Fork(Repeat(Succeed(1), Policy{})))
		Await(f, Sleep(time.Millisecond))
		return Await(f, h.Interrupt())
	}))
	if !exit.Cause().IsInterrupted() {
		t.Fatalf("exit = %v", exit)
	}
}

// "catch + ensuring + interrupt"
func TestEffect4CatchEnsuringInterrupt(t *testing.T) {
	catchFailure, ensuring := false, false
	mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return Ensuring(
				CatchCause(AndThen(signal(started), Never[Unit]()), func(*Cause) Effect[Unit] {
					return Sync(func() Unit { catchFailure = true; return Unit{} })
				}),
				Sync(func() Unit { ensuring = true; return Unit{} }))
		})
		return Await(f, h.Interrupt())
	}))
	if catchFailure || !ensuring {
		t.Fatalf("catch %v, ensuring %v", catchFailure, ensuring)
	}
}

// "run of interruptible"
func TestEffect4RunOfInterruptible(t *testing.T) {
	recovered := false
	mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return Uninterruptible(FlatMap(ToExit(Interruptible(AndThen(signal(started), Never[Unit]()))), func(exit Exit[Unit]) Effect[Unit] {
				return Sync(func() Unit { recovered = !exit.IsSuccess() && exit.Cause().IsInterruptedOnly(); return Unit{} })
			}))
		})
		return Await(f, h.Interrupt())
	}))
	if !recovered {
		t.Fatal("the exit did not record the interruption")
	}
}

// "alternating interruptibility"
func TestEffect4AlternatingInterruptibility(t *testing.T) {
	counter := 0
	increment := func(Exit[Unit]) Effect[Unit] { return Sync(func() Unit { counter++; return Unit{} }) }
	mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			inner := Uninterruptible(FlatMap(ToExit(Interruptible(AndThen(signal(started), Never[Unit]()))), increment))
			return Uninterruptible(FlatMap(ToExit(Interruptible(inner)), increment))
		})
		return Await(f, h.Interrupt())
	}))
	if counter != 2 {
		t.Fatalf("counter = %d", counter)
	}
}

// "acquireUseRelease release runs when use is interrupted"
func TestEffect4ReleaseRunsWhenUseIsInterrupted(t *testing.T) {
	acquired := false
	var releaseExit *ExitAny
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[int] {
			return AcquireUseRelease(
				Sync(func() int { acquired = true; return 123 }),
				func(int) Effect[int] { return AndThen(signal(started), Never[int]()) },
				func(resource int, exit ExitAny) Effect[Unit] {
					return Sync(func() Unit {
						if resource == 123 {
							releaseExit = &exit
						}
						return Unit{}
					})
				})
		})
		return Await(f, h.Interrupt())
	}))
	if !acquired || releaseExit == nil || !releaseExit.Cause.IsInterrupted() || !exit.Cause().IsInterrupted() {
		t.Fatalf("acquired %v, release %v, exit %v", acquired, releaseExit, exit)
	}
}

// "closing scope is uninterruptible"
func TestEffect4ClosingScopeIsUninterruptible(t *testing.T) {
	ref := false
	mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return Uninterruptible(AndThen(signal(started), AndThen(Sleep(10*time.Millisecond), Sync(func() Unit { ref = true; return Unit{} }))))
		})
		return Await(f, h.Interrupt())
	}))
	if !ref {
		t.Fatal("the uninterruptible child did not finish")
	}
}

// "finalizer errors merged"
func TestEffect4FinalizerErrorsMerged(t *testing.T) {
	e2, e3 := errors.New("e2"), errors.New("e3")
	exit := run(Ensuring(Ensuring(Fail[int](errBoom), Die[Unit](e2)), Die[Unit](e3)))
	reasons := exit.Cause().Reasons()
	if len(reasons) != 3 || reasons[0].Err != errBoom || reasons[1].Defect != e2 || reasons[2].Defect != e3 {
		t.Fatalf("cause = %v", exit.Cause())
	}
}
