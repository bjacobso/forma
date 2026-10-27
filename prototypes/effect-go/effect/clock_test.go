package effect

import (
	"context"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

var epoch = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

// TestClock time only moves when the test adjusts it. synctest.Wait waits
// until every fiber in the bubble is parked, so the test observes each
// step deterministically.
func TestTestClockControlsSleep(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		clock := NewTestClock(epoch)
		var woke atomic.Bool
		h := RunFork(context.Background(), WithClock(clock, AndThen(Sleep(time.Hour), Sync(func() Unit { woke.Store(true); return Unit{} }))))
		synctest.Wait()
		if clock.Sleepers() != 1 || woke.Load() {
			t.Fatalf("sleepers %d, woke %v", clock.Sleepers(), woke.Load())
		}
		clock.Adjust(59 * time.Minute)
		synctest.Wait()
		if woke.Load() {
			t.Fatal("woke early")
		}
		clock.Adjust(time.Minute)
		if exit := h.Wait(); !exit.IsSuccess() || !woke.Load() {
			t.Fatalf("exit %v woke %v", exit, woke.Load())
		}
	})
}

func TestRetryFollowsTheScheduleOnTheTestClock(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		clock := NewTestClock(epoch)
		var attempts []time.Duration
		flaky := Gen(func(f *Fiber) string {
			now := Await(f, Now)
			attempts = append(attempts, now.Sub(epoch))
			if len(attempts) < 4 {
				return Await(f, Fail[string](testError{"flaky"}))
			}
			return "ok"
		})
		schedule := Exponential(10 * time.Millisecond)
		h := RunFork(context.Background(), WithClock(clock, Retry(flaky, Policy{Times: 5, Schedule: schedule})))
		for range 3 {
			synctest.Wait()
			clock.Adjust(time.Second)
		}
		exit := h.Wait()
		if value, ok := exit.Value(); !ok || value != "ok" {
			t.Fatalf("exit = %v", exit)
		}
		// Each Adjust wakes the sleeper due at 10ms, 20ms, 40ms after the
		// failure it follows; the clock jumps by a second each time.
		want := []time.Duration{0, time.Second, 2 * time.Second, 3 * time.Second}
		if len(attempts) != len(want) {
			t.Fatalf("attempts at %v", attempts)
		}
		for i := range want {
			if attempts[i] != want[i] {
				t.Fatalf("attempts at %v, want %v", attempts, want)
			}
		}
	})
}

func TestRetryStopsAfterTimes(t *testing.T) {
	var attempts atomic.Int32
	e := Retry(AndThen(Sync(func() int32 { return attempts.Add(1) }), Fail[int](errBoom)), Policy{Times: 2})
	if err := mustFailWith(t, e); err != errBoom || attempts.Load() != 3 {
		t.Fatalf("err %v after %d attempts", err, attempts.Load())
	}
}

func TestRetryDoesNotRetryDefects(t *testing.T) {
	var attempts atomic.Int32
	exit := run(Retry(Sync(func() int { attempts.Add(1); panic("bug") }), Policy{Times: 5}))
	if attempts.Load() != 1 || len(exit.Cause().Defects()) != 1 {
		t.Fatalf("attempts %d, exit %v", attempts.Load(), exit)
	}
}

func TestRepeatRunsOnceThenTimesMore(t *testing.T) {
	var runs atomic.Int32
	spaced := Spaced(time.Millisecond)
	mustSucceed(t, Repeat(Sync(func() int32 { return runs.Add(1) }), Policy{Times: 2, Schedule: spaced}))
	if runs.Load() != 3 {
		t.Fatalf("ran %d times", runs.Load())
	}
}

// Inside a synctest bubble the live clock runs on virtual time, so an hour
// of sleeping and a timeout take no wall time. Go supplies the deterministic
// test scheduler that Effect's TestClock emulates.
func TestLiveClockUnderSynctestUsesVirtualTime(t *testing.T) {
	start := time.Now()
	synctest.Test(t, func(t *testing.T) {
		bubbleStart := time.Now()
		exit := run(Timeout(AndThen(Sleep(2*time.Hour), Succeed("late")), time.Hour))
		if err, _ := exit.Cause().Failure(); err != (TimeoutError{}) {
			t.Fatalf("exit = %v", exit)
		}
		if got := mustSucceed(t, AndThen(Sleep(time.Hour), Now)); got.Sub(bubbleStart) != 2*time.Hour {
			t.Fatalf("virtual time did not advance: %v", got)
		}
	})
	if time.Since(start) > 5*time.Second {
		t.Fatalf("took %v of wall time", time.Since(start))
	}
}

func TestTimeoutOnTestClock(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		clock := NewTestClock(epoch)
		log := &events{}
		h := RunFork(context.Background(), WithClock(clock,
			TimeoutOption(Ensuring(AndThen(Sleep(time.Minute), Succeed(1)), log.add("slow finalized")), 30*time.Second)))
		synctest.Wait()
		clock.Adjust(30 * time.Second)
		exit := h.Wait()
		if value, ok := exit.Value(); !ok || value.IsSome() {
			t.Fatalf("exit = %v", exit)
		}
		log.expect(t, "slow finalized")
	})
}

func TestSeededRandomIsRepeatable(t *testing.T) {
	draw := func() []int {
		return mustSucceed(t, WithRandom(NewRandom(7), All([]Effect[int]{NextIntN(100), NextIntN(100), NextIntN(100)}, Sequential)))
	}
	if a, b := draw(), draw(); !equalInts(a, b) {
		t.Fatalf("%v != %v", a, b)
	}
}
