package concurrentworkflow

// The Go twin of conformance/effect-typescript/cases/concurrent-workflow/harness.ts.
// Adapters run on several goroutines here, so their bookkeeping is locked.

import (
	"context"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bjacobso/forma/prototypes/effect-go/effect"
)

type adapters struct {
	mu          sync.Mutex
	calls       []string
	tracked     []string
	flaky       map[string]int
	inFlight    int
	maxInFlight int
	layer       *effect.Layer
}

func newAdapters() *adapters {
	a := &adapters{flaky: map[string]int{"flaky": 2, "broken": 5}}
	profiles := Profiles{
		Fetch: func(id string) effect.Effect[Profile] {
			return effect.Gen(func(f *effect.Fiber) Profile {
				a.mu.Lock()
				a.calls = append(a.calls, "profile "+id)
				remaining := a.flaky[id]
				if remaining > 0 {
					a.flaky[id] = remaining - 1
				}
				a.mu.Unlock()
				if remaining > 0 {
					return effect.Await(f, effect.Fail[Profile](Unavailable{Service: "profiles"}))
				}
				if id == "slow" {
					effect.Await(f, effect.Sleep(200*time.Millisecond))
				}
				return Profile{Id: id, Name: strings.ToUpper(id)}
			})
		},
		Cached: func(id string) effect.Effect[Profile] {
			return effect.AndThen(effect.Sleep(5*time.Millisecond), effect.Succeed(Profile{Id: id, Name: strings.ToUpper(id) + " (cached)"}))
		},
	}
	activities := Activities{Fetch: func(id string) effect.Effect[Activity] {
		return effect.Ensuring(effect.Gen(func(f *effect.Fiber) Activity {
			a.mu.Lock()
			a.inFlight++
			a.maxInFlight = max(a.maxInFlight, a.inFlight)
			a.mu.Unlock()
			delay := 10 * time.Millisecond
			if id == "slow" {
				delay = 200 * time.Millisecond
			}
			effect.Await(f, effect.Sleep(delay))
			return Activity{Id: id, Events: int64(len(id))}
		}), effect.Sync(func() effect.Unit {
			a.mu.Lock()
			a.inFlight--
			a.mu.Unlock()
			return effect.Unit{}
		}))
	}}
	metrics := Metrics{Track: func(name string, value int64) effect.Effect[effect.Unit] {
		return effect.Sync(func() effect.Unit {
			a.mu.Lock()
			a.tracked = append(a.tracked, fmt.Sprintf("%s=%d", name, value))
			a.mu.Unlock()
			return effect.Unit{}
		})
	}}
	a.layer = effect.MergeAll("Adapters",
		effect.LayerSucceed("Profiles", ProfilesTag, profiles),
		effect.LayerSucceed("Activities", ActivitiesTag, activities),
		effect.LayerSucceed("Metrics", MetricsTag, metrics))
	return a
}

func runWith[A any](t *testing.T, a *adapters, e effect.Effect[A]) A {
	t.Helper()
	value, err := effect.Run(context.Background(), effect.Provide(e, a.layer))
	if err != nil {
		t.Fatalf("unexpected failure: %v", err)
	}
	return value
}

func TestConcurrentWorkflow(t *testing.T) {
	a := newAdapters()

	if got, want := runWith(t, a, DashboardOp("ada")), (Dashboard{Profile: Profile{Id: "ada", Name: "ADA"}, Activity: Activity{Id: "ada", Events: 3}, Score: 30}); got != want {
		t.Fatalf("dashboard: %+v", got)
	}

	// Two failures are retried; the third attempt succeeds.
	flaky := runWith(t, a, DashboardOp("flaky"))
	if flaky.Profile.Name != "FLAKY" {
		t.Fatalf("flaky: %+v", flaky)
	}
	a.mu.Lock()
	flakyCalls := 0
	for _, call := range a.calls {
		if call == "profile flaky" {
			flakyCalls++
		}
	}
	a.mu.Unlock()
	if flakyCalls != 3 {
		t.Fatalf("flaky called %d times", flakyCalls)
	}

	// A failure that outlasts the retry policy surfaces as a typed error.
	if broken := runWith(t, a, effect.Flip(DashboardOp("broken"))); broken != (Unavailable{Service: "profiles"}) {
		t.Fatalf("broken: %v", broken)
	}

	a.mu.Lock()
	a.maxInFlight = 0
	a.mu.Unlock()
	boards := runWith(t, a, Dashboards([]string{"a", "bb", "ccc", "dddd", "eeeee"}))
	scores := make([]int64, len(boards))
	for i, board := range boards {
		scores[i] = board.Score
	}
	if !reflect.DeepEqual(scores, []int64{10, 20, 30, 40, 50}) {
		t.Fatalf("scores %v", scores)
	}
	// Each dashboard fetches one activity; batches run two dashboards at a time.
	if a.maxInFlight != 2 {
		t.Fatalf("max in flight %d", a.maxInFlight)
	}

	if got := runWith(t, a, FastestProfile("slow")); got.Name != "SLOW (cached)" {
		t.Fatalf("fastest: %+v", got)
	}

	if got := runWith(t, a, DashboardWithin("slow", 30)); got.IsSome() {
		t.Fatalf("slow dashboard within 30ms: %v", got)
	}
	inTime := runWith(t, a, DashboardWithin("ada", 1_000))
	if board, ok := inTime.Get(); !ok || board.Score != 30 {
		t.Fatalf("in time: %v", inTime)
	}

	pair := runWith(t, a, CompareActivity("x", "yy"))
	if pair.V1.Events != 1 || pair.V2.Events != 2 {
		t.Fatalf("compare: %+v", pair)
	}

	if total := runWith(t, a, TrackAll([]string{"a", "b", "c"})); total != 3 {
		t.Fatalf("track all: %d", total)
	}
	a.mu.Lock()
	tracked := slices.Sorted(slices.Values(a.tracked))
	a.tracked = nil
	a.mu.Unlock()
	if !reflect.DeepEqual(tracked, []string{"a=1", "b=1", "c=1"}) {
		t.Fatalf("tracked %v", tracked)
	}

	// repeat runs once and then repeats `beats` times on the schedule.
	runWith(t, a, Heartbeat(2))
	if !reflect.DeepEqual(a.tracked, []string{"heartbeat=1", "heartbeat=1", "heartbeat=1"}) {
		t.Fatalf("heartbeat %v", a.tracked)
	}
}
