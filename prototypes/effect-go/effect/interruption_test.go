package effect

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// Interruption scenarios written for the prototype, modelled on the cases
// Effect's suite covers. Direct ports of Effect 4 tests, with Effect's test
// names, are in effect4_port_test.go.

// started forks e after a latch so the test can interrupt it mid-flight.
func forkStarted[A any](f *Fiber, body func(started *Deferred[Unit]) Effect[A]) *Handle[A] {
	started := Await(f, MakeDeferred[Unit]())
	h := Await(f, Fork(body(started)))
	Await(f, started.Await())
	return h
}

func signal(d *Deferred[Unit]) Effect[Unit] { return As(d.Succeed(Unit{}), Unit{}) }

func TestInterruptOfNeverIsInterruptedWithCause(t *testing.T) {
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		h := Await(f, Fork(Never[int]()))
		return Await(f, h.Interrupt())
	}))
	if !exit.Cause().IsInterruptedOnly() {
		t.Fatalf("exit = %v", exit)
	}
}

func TestSleepIsInterruptible(t *testing.T) {
	start := time.Now()
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := Await(f, Fork(Sleep(time.Hour)))
		return Await(f, h.Interrupt())
	}))
	if !exit.Cause().IsInterruptedOnly() || time.Since(start) > time.Second {
		t.Fatalf("exit = %v after %v", exit, time.Since(start))
	}
}

func TestUninterruptibleRegionDefersInterruption(t *testing.T) {
	log := &events{}
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return AndThen(Uninterruptible(AndThen(signal(started), AndThen(Sleep(20*time.Millisecond), log.add("region finished")))),
				log.add("after region"))
		})
		return Await(f, h.Interrupt())
	}))
	if !exit.Cause().IsInterruptedOnly() {
		t.Fatalf("exit = %v", exit)
	}
	log.expect(t, "region finished")
}

func TestAcquireIsUninterruptible(t *testing.T) {
	log := &events{}
	mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[int] {
			acquire := AndThen(signal(started), AndThen(Sleep(20*time.Millisecond), As(log.add("acquired"), 1)))
			return AcquireUseRelease(acquire,
				func(int) Effect[int] { return As(log.add("used"), 1) },
				func(int, ExitAny) Effect[Unit] { return log.add("released") })
		})
		return Await(f, h.Interrupt())
	}))
	log.expect(t, "acquired", "released")
}

func TestUseIsInterruptibleAndReleaseRuns(t *testing.T) {
	var releasedWith atomic.Pointer[ExitAny]
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[int] {
			return AcquireUseRelease(Succeed(1),
				func(int) Effect[int] { return AndThen(signal(started), Never[int]()) },
				func(_ int, exit ExitAny) Effect[Unit] {
					return Sync(func() Unit { releasedWith.Store(&exit); return Unit{} })
				})
		})
		return Await(f, h.Interrupt())
	}))
	if !exit.Cause().IsInterruptedOnly() {
		t.Fatalf("exit = %v", exit)
	}
	if released := releasedWith.Load(); released == nil || !released.Cause.IsInterrupted() {
		t.Fatalf("release saw %v", released)
	}
}

func TestFinalizerCanDetectInterruption(t *testing.T) {
	var sawInterrupt atomic.Bool
	mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return OnExit(AndThen(signal(started), Never[Unit]()), func(exit Exit[Unit]) Effect[Unit] {
				return Sync(func() Unit { sawInterrupt.Store(exit.Cause().IsInterrupted()); return Unit{} })
			})
		})
		return Await(f, h.Interrupt())
	}))
	if !sawInterrupt.Load() {
		t.Fatal("finalizer did not see the interruption")
	}
}

// Inside an uninterruptible region a handler observes the interruption of
// an interruptible part.
func TestRecoveryOfInterruptible(t *testing.T) {
	var recovered atomic.Bool
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return Uninterruptible(MatchCause(Interruptible(AndThen(signal(started), Never[Unit]())),
				func(c *Cause) Effect[Unit] {
					return Sync(func() Unit { recovered.Store(c.IsInterrupted()); return Unit{} })
				},
				func(Unit) Effect[Unit] { return Void }))
		})
		return Await(f, h.Interrupt())
	}))
	if !recovered.Load() {
		t.Fatal("handler did not observe the interruption")
	}
	// Leaving the region re-delivers the interruption.
	if !exit.Cause().IsInterrupted() {
		t.Fatalf("exit = %v", exit)
	}
}

// While interruptible, interruption skips recovery handlers.
func TestCatchCannotRecoverFromInterruption(t *testing.T) {
	var handled atomic.Bool
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[int] {
			return CatchCause(AndThen(signal(started), Never[int]()), func(*Cause) Effect[int] {
				handled.Store(true)
				return Succeed(1)
			})
		})
		return Await(f, h.Interrupt())
	}))
	if handled.Load() || !exit.Cause().IsInterruptedOnly() {
		t.Fatalf("handled=%v exit=%v", handled.Load(), exit)
	}
}

// Interruption is delivered as soon as an interruptible region is entered
// inside an uninterruptible one.
func TestInterruptibleRegionInsideUninterruptible(t *testing.T) {
	log := &events{}
	mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return Uninterruptible(AndThen(signal(started),
				AndThen(Sleep(10*time.Millisecond),
					AndThen(log.add("uninterruptible"),
						AndThen(Interruptible(log.add("interruptible")), log.add("after"))))))
		})
		return Await(f, h.Interrupt())
	}))
	log.expect(t, "uninterruptible")
}

// Interrupting a race interrupts both sides.
func TestInterruptionOfRaced(t *testing.T) {
	var left, right atomic.Bool
	mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[int] {
			return AndThen(signal(started), Race(
				OnInterrupt(Never[int](), Sync(func() Unit { left.Store(true); return Unit{} })),
				OnInterrupt(Never[int](), Sync(func() Unit { right.Store(true); return Unit{} }))))
		})
		Await(f, Sleep(5*time.Millisecond))
		return Await(f, h.Interrupt())
	}))
	if !left.Load() || !right.Load() {
		t.Fatalf("left=%v right=%v", left.Load(), right.Load())
	}
}

// The interruptor's id is recorded in the cause.
func TestCauseRecordsTheInterruptor(t *testing.T) {
	var parent uint64
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		parent = f.ID()
		h := Await(f, Fork(Never[int]()))
		return Await(f, h.Interrupt())
	}))
	if reasons := exit.Cause().Reasons(); len(reasons) != 1 || reasons[0].FiberID != parent {
		t.Fatalf("cause = %v, interruptor %d", exit.Cause(), parent)
	}
}

func TestEnsuringRunsOnSuccessFailureAndInterruption(t *testing.T) {
	log := &events{}
	run(Ensuring(Succeed(1), log.add("success")))
	run(Ensuring(Fail[int](errBoom), log.add("failure")))
	run(Ensuring(Die[int]("bug"), log.add("defect")))
	mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[int] {
			return Ensuring(AndThen(signal(started), Never[int]()), log.add("interruption"))
		})
		return Await(f, h.Interrupt())
	}))
	log.expect(t, "success", "failure", "defect", "interruption")
}

func TestFinalizersAreUninterruptible(t *testing.T) {
	log := &events{}
	mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[int] {
			slowFinalizer := AndThen(Sleep(20*time.Millisecond), log.add("finalizer finished"))
			return Ensuring(AndThen(signal(started), Never[int]()), slowFinalizer)
		})
		return Await(f, h.Interrupt())
	}))
	log.expect(t, "finalizer finished")
}

func TestFinalizerFailureIsAddedToTheCause(t *testing.T) {
	exit := run(Ensuring(Fail[int](testError{"body"}), Fail[Unit](testError{"finalizer"})))
	failures := exit.Cause().Failures()
	if len(failures) != 2 || failures[0] != (testError{"body"}) || failures[1] != (testError{"finalizer"}) {
		t.Fatalf("cause = %v", exit.Cause())
	}
}

// Supervision: a parent that finishes interrupts its children and waits
// for their finalizers before it completes.
func TestChildrenAreInterruptedWhenTheParentEnds(t *testing.T) {
	log := &events{}
	exit := run(Gen(func(f *Fiber) string {
		parent := Await(f, Fork(Gen(func(p *Fiber) string {
			forkStarted(p, func(started *Deferred[Unit]) Effect[Unit] {
				return Ensuring(AndThen(signal(started), Never[Unit]()), AndThen(Sleep(5*time.Millisecond), log.add("child finalizer")))
			})
			return "parent done"
		})))
		value := Await(f, parent.Join())
		log.record("joined parent")
		return value
	}))
	if value, _ := exit.Value(); value != "parent done" {
		t.Fatalf("exit = %v", exit)
	}
	log.expect(t, "child finalizer", "joined parent")
}

func TestGrandchildrenAreInterruptedTransitively(t *testing.T) {
	log := &events{}
	mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return Gen(func(child *Fiber) Unit {
				forkStarted(child, func(grandchildStarted *Deferred[Unit]) Effect[Unit] {
					return Ensuring(AndThen(signal(grandchildStarted), Never[Unit]()), log.add("grandchild"))
				})
				Await(child, signal(started))
				return Await(child, Ensuring(Never[Unit](), log.add("child")))
			})
		})
		return Await(f, h.Interrupt())
	}))
	log.expect(t, "child", "grandchild")
}

func TestDaemonFibersOutliveTheirParent(t *testing.T) {
	release := make(chan struct{})
	daemon := mustSucceed(t, Gen(func(f *Fiber) *Handle[string] {
		return Await(f, ForkDaemon(AndThen(Sync(func() Unit { <-release; return Unit{} }), Succeed("still running"))))
	}))
	close(release)
	if value, ok := daemon.Wait().Value(); !ok || value != "still running" {
		t.Fatalf("daemon exit = %v", daemon.Wait())
	}
}

func TestJoinPropagatesTheChildsFailure(t *testing.T) {
	err := mustFailWith(t, Gen(func(f *Fiber) int {
		h := Await(f, Fork(Fail[int](testError{"child"})))
		return Await(f, h.Join())
	}))
	if err != (testError{"child"}) {
		t.Fatalf("got %v", err)
	}
}

func TestRaceInterruptsTheLoserBeforeReturning(t *testing.T) {
	log := &events{}
	got := mustSucceed(t, AndThen(
		Race(
			AndThen(Sleep(5*time.Millisecond), As(log.add("fast won"), "fast")),
			Ensuring(AndThen(Sleep(time.Hour), Succeed("slow")), log.add("slow finalized")),
		),
		Sync(func() string { log.record("race returned"); return "" })))
	_ = got
	log.expect(t, "fast won", "slow finalized", "race returned")
}

func TestRaceFallsBackWhenTheFirstFails(t *testing.T) {
	got := mustSucceed(t, Race(Fail[string](errBoom), AndThen(Sleep(5*time.Millisecond), Succeed("second"))))
	if got != "second" {
		t.Fatalf("got %q", got)
	}
	exit := run(Race(Fail[string](testError{"a"}), AndThen(Sleep(time.Millisecond), Fail[string](testError{"b"}))))
	if failures := exit.Cause().Failures(); len(failures) != 2 {
		t.Fatalf("cause = %v", exit.Cause())
	}
}

func TestTimeoutInterruptsAndRunsFinalizersFirst(t *testing.T) {
	log := &events{}
	err := mustFailWith(t, AndThen(
		Timeout(Ensuring(Never[int](), log.add("finalized")), 10*time.Millisecond),
		Succeed(0)))
	if err != (TimeoutError{}) {
		t.Fatalf("got %v", err)
	}
	log.expect(t, "finalized")
	if got := mustSucceed(t, Timeout(Succeed(3), time.Second)); got != 3 {
		t.Fatalf("got %d", got)
	}
}

func TestInterruptingTheRootThroughGoContext(t *testing.T) {
	log := &events{}
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(10*time.Millisecond, cancel)
	exit := RunExit(ctx, Ensuring(Never[int](), log.add("finalized")))
	if !exit.Cause().IsInterruptedOnly() {
		t.Fatalf("exit = %v", exit)
	}
	log.expect(t, "finalized")
}

func TestBlockingSeesContextCancellation(t *testing.T) {
	var sawCancel atomic.Bool
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[int] {
			return AndThen(signal(started), Blocking(func(ctx context.Context) (int, error) {
				<-ctx.Done()
				sawCancel.Store(true)
				return 0, ctx.Err()
			}))
		})
		return Await(f, h.Interrupt())
	}))
	if !sawCancel.Load() || !exit.Cause().IsInterruptedOnly() {
		t.Fatalf("saw cancel %v, exit %v", sawCancel.Load(), exit)
	}
}

// A blocking call that ignores its context delays interruption until it
// returns; Detached abandons it instead.
func TestBlockingVersusDetached(t *testing.T) {
	ignoreCtx := func(release chan struct{}) func(context.Context) (int, error) {
		return func(context.Context) (int, error) { <-release; return 1, nil }
	}
	measure := func(effect func(func(context.Context) (int, error)) Effect[int]) (time.Duration, Exit[int]) {
		release := make(chan struct{})
		time.AfterFunc(30*time.Millisecond, func() { close(release) })
		start := time.Now()
		exit := mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
			h := Await(f, Fork(effect(ignoreCtx(release))))
			Await(f, Sleep(time.Millisecond))
			return Await(f, h.Interrupt())
		}))
		return time.Since(start), exit
	}
	blockingTook, blockingExit := measure(Blocking[int])
	detachedTook, detachedExit := measure(Detached[int])
	if !blockingExit.Cause().IsInterrupted() || !detachedExit.Cause().IsInterrupted() {
		t.Fatalf("exits %v %v", blockingExit, detachedExit)
	}
	if blockingTook < 25*time.Millisecond || detachedTook > 25*time.Millisecond {
		t.Fatalf("blocking took %v, detached took %v", blockingTook, detachedTook)
	}
}

// Go code between Awaits cannot be preempted by interruption; the next
// Await is the interruption point.
func TestAwaitIsTheInterruptionPoint(t *testing.T) {
	log := &events{}
	release := make(chan struct{})
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return Gen(func(c *Fiber) Unit {
				Await(c, signal(started))
				<-release // plain Go: not an interruption point
				log.record("plain Go finished")
				Await(c, log.add("next await"))
				return Unit{}
			})
		})
		h.fiber.interruptAs(f.ID())
		close(release)
		return Await(f, h.Await())
	}))
	if !exit.Cause().IsInterruptedOnly() {
		t.Fatalf("exit = %v", exit)
	}
	log.expect(t, "plain Go finished")
}

func TestInterruptingAnUninterruptibleBlockingCallWaits(t *testing.T) {
	var cancelled atomic.Bool
	mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[int] {
			return AndThen(signal(started), Uninterruptible(Blocking(func(ctx context.Context) (int, error) {
				select {
				case <-ctx.Done():
					cancelled.Store(true)
				case <-time.After(10 * time.Millisecond):
				}
				return 1, nil
			})))
		})
		return Await(f, h.Interrupt())
	}))
	if cancelled.Load() {
		t.Fatal("an uninterruptible blocking call saw cancellation")
	}
}
