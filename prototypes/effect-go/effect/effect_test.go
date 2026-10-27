package effect

import (
	"errors"
	"strings"
	"testing"
)

func TestSequencing(t *testing.T) {
	e := FlatMap(Succeed(20), func(n int) Effect[int] {
		return Map(Sync(func() int { return n + 1 }), func(m int) int { return m * 2 })
	})
	if got := mustSucceed(t, e); got != 42 {
		t.Fatalf("got %d", got)
	}
}

func TestEffectsAreDescriptions(t *testing.T) {
	calls := 0
	e := Sync(func() int { calls++; return calls })
	twice := FlatMap(e, func(a int) Effect[int] { return Map(e, func(b int) int { return a*10 + b }) })
	if got := mustSucceed(t, twice); got != 12 {
		t.Fatalf("got %d", got)
	}
}

func TestDeepFlatMapChainIsStackSafe(t *testing.T) {
	e := Succeed(0)
	for range 200_000 {
		e = FlatMap(e, func(n int) Effect[int] { return Succeed(n + 1) })
	}
	if got := mustSucceed(t, e); got != 200_000 {
		t.Fatalf("got %d", got)
	}
}

func TestTypedFailure(t *testing.T) {
	exit := run(AndThen(Fail[int](testError{"nope"}), Succeed(1)))
	if exit.IsSuccess() {
		t.Fatal("expected failure")
	}
	var target testError
	if !errors.As(exit.Err(), &target) || target.name != "nope" {
		t.Fatalf("Err() = %v", exit.Err())
	}
}

func TestPanicsBecomeDefects(t *testing.T) {
	cases := map[string]Effect[int]{
		"sync":    Sync(func() int { panic("sync") }),
		"flatMap": FlatMap(Succeed(1), func(int) Effect[int] { panic("flatMap") }),
		"gen":     Gen(func(*Fiber) int { panic("gen") }),
		"suspend": Suspend(func() Effect[int] { panic("suspend") }),
	}
	for name, e := range cases {
		t.Run(name, func(t *testing.T) {
			exit := run(e)
			defects := exit.Cause().Defects()
			if len(defects) != 1 || defects[0] != name {
				t.Fatalf("exit = %v", exit)
			}
			if !strings.Contains(exit.Cause().Reasons()[0].Stack, "goroutine") {
				t.Fatal("defect has no stack")
			}
		})
	}
}

func TestPanicInForkedFiberDoesNotKillTheProcess(t *testing.T) {
	e := Gen(func(f *Fiber) Exit[int] {
		h := Await(f, Fork(Sync(func() int { panic("in child") })))
		return Await(f, h.Await())
	})
	exit := mustSucceed(t, e)
	if defects := exit.Cause().Defects(); len(defects) != 1 || defects[0] != "in child" {
		t.Fatalf("child exit = %v", exit)
	}
}

func TestCatchTagMatchesByType(t *testing.T) {
	handled := CatchTag(Fail[string](testError{"missing"}), func(e testError) Effect[string] {
		return Succeed("recovered " + e.name)
	})
	if got := mustSucceed(t, handled); got != "recovered missing" {
		t.Fatalf("got %q", got)
	}
	passed := CatchTag(Fail[string](otherError{}), func(testError) Effect[string] { return Succeed("wrong") })
	if err := mustFailWith(t, passed); err != (otherError{}) {
		t.Fatalf("got %v", err)
	}
	defect := CatchTag(Die[string]("bug"), func(testError) Effect[string] { return Succeed("wrong") })
	if exit := run(defect); len(exit.Cause().Defects()) != 1 {
		t.Fatalf("a defect was caught: %v", exit)
	}
}

func TestErrorCombinators(t *testing.T) {
	if err := mustFailWith(t, MapError(Fail[int](errBoom), func(err error) error { return testError{err.Error()} })); err != (testError{"boom"}) {
		t.Fatalf("MapError: %v", err)
	}
	if got := mustSucceed(t, OrElseSucceed(Fail[int](errBoom), func() int { return 7 })); got != 7 {
		t.Fatalf("OrElseSucceed: %d", got)
	}
	if exit := run(OrDie(Fail[int](errBoom))); exit.Cause().Defects()[0] != errBoom {
		t.Fatalf("OrDie: %v", exit)
	}
	if got := mustSucceed(t, ToOption(Fail[int](errBoom))); got.IsSome() {
		t.Fatalf("ToOption: %v", got)
	}
	if got := mustSucceed(t, ToResult(Fail[int](errBoom))); got.IsSuccess() {
		t.Fatalf("ToResult: %v", got)
	}
	if got := mustSucceed(t, Flip(Fail[int](errBoom))); got != errBoom {
		t.Fatalf("Flip: %v", got)
	}
	if exit := run(ToOption(Die[int]("bug"))); exit.IsSuccess() {
		t.Fatal("ToOption swallowed a defect")
	}
}

func TestGenShortCircuitsAndRunsDefers(t *testing.T) {
	log := &events{}
	e := Gen(func(f *Fiber) int {
		defer log.record("deferred")
		a := Await(f, Succeed(1))
		log.record("before failure")
		Await(f, Fail[int](testError{"stop"}))
		log.record("unreachable")
		return a
	})
	if err := mustFailWith(t, e); err != (testError{"stop"}) {
		t.Fatalf("got %v", err)
	}
	log.expect(t, "before failure", "deferred")
}

func TestTryReturnsTypedFailures(t *testing.T) {
	e := Gen(func(f *Fiber) string {
		if _, err := Try(f, Fail[int](testError{"soft"})); err != nil {
			return "handled " + err.Error()
		}
		return "no error"
	})
	if got := mustSucceed(t, e); got != "handled soft" {
		t.Fatalf("got %q", got)
	}
	defect := Gen(func(f *Fiber) string {
		_, _ = Try(f, Die[int]("hard"))
		return "resumed after a defect"
	})
	if exit := run(defect); exit.IsSuccess() {
		t.Fatal("Try resumed the body after a defect")
	}
}

func TestNestedGenFailureCrossesLevels(t *testing.T) {
	inner := Gen(func(f *Fiber) int { return Await(f, Fail[int](testError{"inner"})) })
	outer := Gen(func(f *Fiber) int { return Await(f, inner) + 1 })
	recovered := CatchTag(outer, func(e testError) Effect[int] { return Succeed(len(e.name)) })
	if got := mustSucceed(t, recovered); got != 5 {
		t.Fatalf("got %d", got)
	}
}

func TestMissingServiceIsADefect(t *testing.T) {
	tag := NewTag[string]("Greeting")
	exit := run(tag.Effect())
	defects := exit.Cause().Defects()
	if len(defects) != 1 || defects[0] != (MissingServiceError{Service: "Greeting"}) {
		t.Fatalf("exit = %v", exit)
	}
	if got := mustSucceed(t, ProvideService(tag.Effect(), tag, "hello")); got != "hello" {
		t.Fatalf("got %q", got)
	}
}

func TestFiberRefLocallyAndFork(t *testing.T) {
	ref := NewFiberRef("level", 0)
	e := Gen(func(f *Fiber) []int {
		inside := Await(f, Locally(ref, 1, ref.Get()))
		after := Await(f, ref.Get())
		Await(f, ref.Set(5))
		child := Await(f, Fork(Gen(func(c *Fiber) int {
			seen := Await(c, ref.Get())
			Await(c, ref.Set(9))
			return seen
		})))
		inChild := Await(f, child.Join())
		return []int{inside, after, inChild, Await(f, ref.Get())}
	})
	got := mustSucceed(t, e)
	if want := []int{1, 0, 5, 5}; !equalInts(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestLocallyRestoresOnFailure(t *testing.T) {
	ref := NewFiberRef("level", 0)
	e := FlatMap(ToExit(Locally(ref, 3, Fail[int](errBoom))), func(Exit[int]) Effect[int] { return ref.Get() })
	if got := mustSucceed(t, e); got != 0 {
		t.Fatalf("got %d", got)
	}
}

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
