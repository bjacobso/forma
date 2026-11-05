package effect

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestForEachKeepsOrderAndBoundsConcurrency(t *testing.T) {
	for _, concurrency := range []int{Sequential, 2, 3, Unbounded} {
		var inFlight, maxInFlight atomic.Int32
		work := func(n int) Effect[int] {
			return Ensuring(Gen(func(f *Fiber) int {
				now := inFlight.Add(1)
				for {
					seen := maxInFlight.Load()
					if now <= seen || maxInFlight.CompareAndSwap(seen, now) {
						break
					}
				}
				Await(f, Sleep(time.Duration(10-n)*time.Millisecond))
				return n * n
			}), Sync(func() Unit { inFlight.Add(-1); return Unit{} }))
		}
		got := mustSucceed(t, ForEach([]int{1, 2, 3, 4, 5, 6}, work, concurrency))
		if want := []int{1, 4, 9, 16, 25, 36}; !equalInts(got, want) {
			t.Fatalf("concurrency %d: got %v", concurrency, got)
		}
		limit := int32(concurrency)
		if concurrency == Unbounded {
			limit = 6
		}
		if maxInFlight.Load() != limit {
			t.Fatalf("concurrency %d: max in flight %d", concurrency, maxInFlight.Load())
		}
	}
}

func TestForEachFailureInterruptsSiblings(t *testing.T) {
	log := &events{}
	work := func(n int) Effect[int] {
		if n == 2 {
			return AndThen(Sleep(5*time.Millisecond), Fail[int](testError{"two"}))
		}
		return Ensuring(AndThen(Sleep(time.Hour), Succeed(n)), log.add("interrupted sibling"))
	}
	err := mustFailWith(t, AndThen(ForEach([]int{1, 2, 3}, work, Unbounded), Succeed([]int{})))
	if err != (testError{"two"}) {
		t.Fatalf("got %v", err)
	}
	log.expect(t, "interrupted sibling", "interrupted sibling")
}

func TestAll2RunsConcurrently(t *testing.T) {
	start := time.Now()
	got := mustSucceed(t, All2(
		AndThen(Sleep(20*time.Millisecond), Succeed("profile")),
		AndThen(Sleep(20*time.Millisecond), Succeed(3)),
		Unbounded))
	if got.V1 != "profile" || got.V2 != 3 {
		t.Fatalf("got %+v", got)
	}
	if elapsed := time.Since(start); elapsed > 35*time.Millisecond {
		t.Fatalf("took %v; not concurrent", elapsed)
	}
}

func TestInterruptingForEachInterruptsWorkers(t *testing.T) {
	log := &events{}
	mustSucceed(t, Gen(func(f *Fiber) Exit[[]int] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[[]int] {
			return AndThen(signal(started), ForEach([]int{1, 2}, func(int) Effect[int] {
				return Ensuring(Never[int](), log.add("worker finalized"))
			}, Unbounded))
		})
		Await(f, Sleep(5*time.Millisecond))
		return Await(f, h.Interrupt())
	}))
	log.expect(t, "worker finalized", "worker finalized")
}

func TestDeferredHandsOffBetweenFibers(t *testing.T) {
	got := mustSucceed(t, Gen(func(f *Fiber) string {
		d := Await(f, MakeDeferred[string]())
		Await(f, Fork(AndThen(Sleep(time.Millisecond), d.Succeed("from child"))))
		return Await(f, d.Await())
	}))
	if got != "from child" {
		t.Fatalf("got %q", got)
	}
}

func TestQueueTakeWaitsAndIsInterruptible(t *testing.T) {
	got := mustSucceed(t, Gen(func(f *Fiber) []int {
		q := Await(f, MakeQueue[int](1))
		consumer := Await(f, Fork(All([]Effect[int]{q.Take(), q.Take(), q.Take()}, Sequential)))
		for i := range 3 {
			Await(f, q.Offer(i))
		}
		return Await(f, consumer.Join())
	}))
	if !equalInts(got, []int{0, 1, 2}) {
		t.Fatalf("got %v", got)
	}
	exit := mustSucceed(t, Gen(func(f *Fiber) Exit[int] {
		q := Await(f, MakeQueue[int](1))
		h := Await(f, Fork(q.Take()))
		return Await(f, h.Interrupt())
	}))
	if !exit.Cause().IsInterruptedOnly() {
		t.Fatalf("exit = %v", exit)
	}
}

func TestSemaphoreLimitsAndReleasesOnFailure(t *testing.T) {
	var inFlight, maxInFlight atomic.Int32
	got := mustSucceed(t, Gen(func(f *Fiber) int {
		s := Await(f, MakeSemaphore(2))
		task := func(n int) Effect[int] {
			return WithPermits(s, 1, Gen(func(g *Fiber) int {
				now := inFlight.Add(1)
				defer inFlight.Add(-1)
				for {
					seen := maxInFlight.Load()
					if now <= seen || maxInFlight.CompareAndSwap(seen, now) {
						break
					}
				}
				Await(g, Sleep(2*time.Millisecond))
				if n%2 == 0 {
					return Await(g, Fail[int](testError{"even"}))
				}
				return n
			}))
		}
		results := Await(f, ForEach([]int{1, 2, 3, 4, 5, 6}, func(n int) Effect[Option[int]] { return ToOption(task(n)) }, Unbounded))
		sum := 0
		for _, r := range results {
			sum += r.GetOrElse(0)
		}
		// All permits came back, so a full-width acquisition succeeds.
		Await(f, Timeout(WithPermits(s, 2, Void), time.Second))
		return sum
	}))
	if got != 9 || maxInFlight.Load() != 2 {
		t.Fatalf("sum %d, max in flight %d", got, maxInFlight.Load())
	}
}

func TestPubSubBroadcasts(t *testing.T) {
	got := mustSucceed(t, Scoped(Gen(func(f *Fiber) []int {
		hub := Await(f, MakePubSub[int](4))
		a := Await(f, hub.Subscribe())
		b := Await(f, hub.Subscribe())
		Await(f, hub.Publish(1))
		Await(f, hub.Publish(2))
		return []int{Await(f, a.Take()), Await(f, a.Take()), Await(f, b.Take()), Await(f, b.Take())}
	})))
	if !equalInts(got, []int{1, 2, 1, 2}) {
		t.Fatalf("got %v", got)
	}
}
