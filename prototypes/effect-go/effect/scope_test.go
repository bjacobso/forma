package effect

import (
	"sync/atomic"
	"testing"
	"time"
)

func resource(log *events, name string) Effect[string] {
	return AcquireRelease(As(log.add("acquire "+name), name), func(_ string, exit ExitAny) Effect[Unit] {
		outcome := "success"
		switch {
		case exit.Cause.IsInterrupted():
			outcome = "interrupt"
		case exit.Cause != nil:
			outcome = "failure"
		}
		return log.add("release " + name + " on " + outcome)
	})
}

func threeResources(log *events, then Effect[Unit]) Effect[Unit] {
	return Scoped(Gen(func(f *Fiber) Unit {
		Await(f, resource(log, "a"))
		Await(f, resource(log, "b"))
		Await(f, resource(log, "c"))
		return Await(f, then)
	}))
}

func TestScopeReleasesInReverseOnSuccess(t *testing.T) {
	log := &events{}
	mustSucceed(t, threeResources(log, log.add("use")))
	log.expect(t, "acquire a", "acquire b", "acquire c", "use",
		"release c on success", "release b on success", "release a on success")
}

func TestScopeReleasesInReverseOnFailure(t *testing.T) {
	log := &events{}
	if err := mustFailWith(t, threeResources(log, Fail[Unit](errBoom))); err != errBoom {
		t.Fatalf("got %v", err)
	}
	log.expect(t, "acquire a", "acquire b", "acquire c",
		"release c on failure", "release b on failure", "release a on failure")
}

func TestScopeReleasesInReverseOnInterruption(t *testing.T) {
	log := &events{}
	mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return threeResources(log, AndThen(signal(started), Never[Unit]()))
		})
		return Await(f, h.Interrupt())
	}))
	log.expect(t, "acquire a", "acquire b", "acquire c",
		"release c on interrupt", "release b on interrupt", "release a on interrupt")
}

func TestEveryFinalizerRunsWhenOneFails(t *testing.T) {
	log := &events{}
	e := Scoped(Gen(func(f *Fiber) Unit {
		Await(f, AddFinalizer(func(ExitAny) Effect[Unit] { return log.add("first") }))
		Await(f, AddFinalizer(func(ExitAny) Effect[Unit] { return Fail[Unit](testError{"finalizer"}) }))
		Await(f, AddFinalizer(func(ExitAny) Effect[Unit] { return log.add("third") }))
		return Unit{}
	}))
	if err := mustFailWith(t, e); err != (testError{"finalizer"}) {
		t.Fatalf("got %v", err)
	}
	log.expect(t, "third", "first")
}

func TestAddingToAClosedScopeRunsTheFinalizer(t *testing.T) {
	log := &events{}
	scope := NewScope()
	mustSucceed(t, AndThen(scope.Close(ExitAny{}), scope.AddFinalizer(func(ExitAny) Effect[Unit] { return log.add("late") })))
	log.expect(t, "late")
}

func TestAcquireReleaseWithoutScopeIsADefect(t *testing.T) {
	exit := run(resource(&events{}, "orphan"))
	if defects := exit.Cause().Defects(); len(defects) != 1 || defects[0] != (MissingServiceError{Service: "Scope"}) {
		t.Fatalf("exit = %v", exit)
	}
}

type counter struct{ value int }

var counterTag = NewTag[*counter]("Counter")
var greeterTag = NewTag[func() string]("Greeter")

func TestLayersAreMemoizedAndScoped(t *testing.T) {
	log := &events{}
	var builds atomic.Int32
	counterLayer := LayerEffect("CounterLive", counterTag, Gen(func(f *Fiber) *counter {
		builds.Add(1)
		Await(f, resource(log, "counter"))
		return &counter{value: 41}
	}))
	greeterLayer := ProvideLayer("GreeterLive", LayerEffect("Greeter", greeterTag, Gen(func(f *Fiber) func() string {
		c := counterTag.Get(f)
		return func() string { return "count " + string(rune('0'+c.value%10)) }
	})), counterLayer)
	app := MergeAll("App", counterLayer, greeterLayer)

	program := Gen(func(f *Fiber) string {
		counterTag.Get(f).value++
		Await(f, log.add("program"))
		return greeterTag.Get(f)()
	})
	got := mustSucceed(t, Provide(program, app))
	if got != "count 2" {
		t.Fatalf("got %q", got)
	}
	if builds.Load() != 1 {
		t.Fatalf("counter layer built %d times", builds.Load())
	}
	log.expect(t, "acquire counter", "program", "release counter on success")

	// A second Provide builds the layer again.
	mustSucceed(t, Provide(program, app))
	if builds.Load() != 2 {
		t.Fatalf("counter layer built %d times", builds.Load())
	}
}

func TestLayerConstructionFailureFailsProvide(t *testing.T) {
	broken := LayerEffect("Broken", counterTag, Fail[*counter](testError{"config"}))
	if err := mustFailWith(t, Provide(Succeed(1), broken)); err != (testError{"config"}) {
		t.Fatalf("got %v", err)
	}
}

func TestProvideReleasesLayerResourcesOnInterruption(t *testing.T) {
	log := &events{}
	layer := LayerEffect("Resourceful", counterTag, As(resource(log, "conn"), &counter{}))
	mustSucceed(t, Gen(func(f *Fiber) Exit[Unit] {
		h := forkStarted(f, func(started *Deferred[Unit]) Effect[Unit] {
			return Provide(AndThen(signal(started), Never[Unit]()), layer)
		})
		return Await(f, h.Interrupt())
	}))
	log.expect(t, "acquire conn", "release conn on interrupt")
}

func TestReleaseRunsWithTheServicesFromAcquisition(t *testing.T) {
	tag := NewTag[string]("Label")
	var seen atomic.Value
	e := Scoped(ProvideService(AcquireRelease(Succeed(1), func(int, ExitAny) Effect[Unit] {
		return Map(tag.Effect(), func(label string) Unit { seen.Store(label); return Unit{} })
	}), tag, "acquired here"))
	mustSucceed(t, e)
	if seen.Load() != "acquired here" {
		t.Fatalf("release saw %v", seen.Load())
	}
}

func TestScopedLayerOutlivesItsConstruction(t *testing.T) {
	log := &events{}
	layer := LayerEffect("Pool", counterTag, Gen(func(f *Fiber) *counter {
		Await(f, resource(log, "pool"))
		Await(f, log.add("layer built"))
		return &counter{}
	}))
	mustSucceed(t, Provide(AndThen(Sleep(time.Millisecond), log.add("using pool")), layer))
	log.expect(t, "acquire pool", "layer built", "using pool", "release pool on success")
}
