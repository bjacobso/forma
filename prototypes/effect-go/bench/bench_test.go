// Package bench measures the effect-go runtime against plain Go for RFC 0019.
//
//	go test -run '^$' -bench . -benchmem ./bench/
package bench

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/bjacobso/forma/prototypes/effect-go/bench/pure"
	"github.com/bjacobso/forma/prototypes/effect-go/effect"
)

const steps = 1000

var ctx = context.Background()

//go:noinline
func step(n int) (int, error) { return n + 1, nil }

// Sequential chain: 1000 dependent steps.

func BenchmarkChainPlainGo(b *testing.B) {
	for b.Loop() {
		n := 0
		for range steps {
			var err error
			if n, err = step(n); err != nil {
				b.Fatal(err)
			}
		}
	}
}

func chain() effect.Effect[int] {
	e := effect.Succeed(0)
	for range steps {
		e = effect.FlatMap(e, func(n int) effect.Effect[int] { return effect.Sync(func() int { return n + 1 }) })
	}
	return e
}

// The description is built once and run each iteration.
func BenchmarkChainFlatMap(b *testing.B) {
	e := chain()
	for b.Loop() {
		effect.RunExit(ctx, e)
	}
}

func BenchmarkChainFlatMapBuildAndRun(b *testing.B) {
	for b.Loop() {
		effect.RunExit(ctx, chain())
	}
}

func BenchmarkChainGenAwaitSync(b *testing.B) {
	e := effect.Gen(func(f *effect.Fiber) int {
		n := 0
		for range steps {
			n = effect.Await(f, effect.Sync(func() int { return n + 1 }))
		}
		return n
	})
	for b.Loop() {
		effect.RunExit(ctx, e)
	}
}

// What generated code does for a call to another operation.
func increment(n int) effect.Effect[int] {
	return effect.Gen(func(*effect.Fiber) int { return n + 1 })
}

func BenchmarkChainGenAwaitOperation(b *testing.B) {
	e := effect.Gen(func(f *effect.Fiber) int {
		n := 0
		for range steps {
			n = effect.Await(f, increment(n))
		}
		return n
	})
	for b.Loop() {
		effect.RunExit(ctx, e)
	}
}

// Fan-out: 1000 tasks, each a tiny computation, joined in order.

func work(i int) int { return i * 2 }

func BenchmarkFanOutGoroutines(b *testing.B) {
	for b.Loop() {
		results := make([]int, steps)
		var wg sync.WaitGroup
		for i := range steps {
			wg.Go(func() { results[i] = work(i) })
		}
		wg.Wait()
	}
}

func BenchmarkFanOutGoroutinesWithContext(b *testing.B) {
	for b.Loop() {
		ctx, cancel := context.WithCancel(ctx)
		results := make([]int, steps)
		errs := make(chan error, steps)
		var wg sync.WaitGroup
		for i := range steps {
			wg.Go(func() {
				if ctx.Err() != nil {
					errs <- ctx.Err()
					return
				}
				results[i] = work(i)
			})
		}
		wg.Wait()
		cancel()
	}
}

func BenchmarkFanOutForkJoin(b *testing.B) {
	e := effect.Gen(func(f *effect.Fiber) int {
		handles := make([]*effect.Handle[int], steps)
		for i := range steps {
			handles[i] = effect.Await(f, effect.Fork(effect.Sync(func() int { return work(i) })))
		}
		total := 0
		for _, h := range handles {
			total += effect.Await(f, h.Join())
		}
		return total
	})
	for b.Loop() {
		effect.RunExit(ctx, e)
	}
}

func fanOut(concurrency int) effect.Effect[[]int] {
	items := make([]int, steps)
	for i := range items {
		items[i] = i
	}
	return effect.ForEach(items, func(i int) effect.Effect[int] { return effect.Sync(func() int { return work(i) }) }, concurrency)
}

func BenchmarkFanOutForEachUnbounded(b *testing.B) {
	e := fanOut(effect.Unbounded)
	for b.Loop() {
		effect.RunExit(ctx, e)
	}
}

func BenchmarkFanOutForEach16(b *testing.B) {
	e := fanOut(16)
	for b.Loop() {
		effect.RunExit(ctx, e)
	}
}

// Pure hot loop: sum of squares over 1000 Ints.

var numbers = func() []int64 {
	xs := make([]int64, steps)
	for i := range xs {
		xs[i] = int64(i)
	}
	return xs
}()

var sink int64

func BenchmarkPureHandWrittenGo(b *testing.B) {
	for b.Loop() {
		acc := int64(0)
		for _, x := range numbers {
			acc += x * x
		}
		sink = acc
	}
}

// The generated function: forma.Reduce with checked Int arithmetic.
func BenchmarkPureGeneratedGo(b *testing.B) {
	for b.Loop() {
		sink = pure.SumOfSquares(numbers)
	}
}

// The same pure function called once from an effect.
func BenchmarkPureGeneratedInsideEffect(b *testing.B) {
	e := pure.Checksum(numbers)
	for b.Loop() {
		sink, _ = effect.Run(ctx, e)
	}
}

// The loop interpreted: one effect per element, as if pure code were not
// compiled separately.
func BenchmarkPureInterpreted(b *testing.B) {
	e := effect.Succeed(int64(0))
	for _, x := range numbers {
		e = effect.FlatMap(e, func(acc int64) effect.Effect[int64] { return effect.Sync(func() int64 { return acc + x*x }) })
	}
	for b.Loop() {
		sink, _ = effect.Run(ctx, e)
	}
}

// Failure path: a typed failure raised and recovered 1000 times.

type notFound struct{}

func (notFound) Error() string { return "not found" }

//go:noinline
func lookup() (int, error) { return 0, notFound{} }

func BenchmarkFailurePlainGo(b *testing.B) {
	for b.Loop() {
		recovered := 0
		for range steps {
			if _, err := lookup(); errors.As(err, new(notFound)) {
				recovered++
			}
		}
	}
}

// Await unwinds the Gen body with a panic; CatchTag recovers.
func BenchmarkFailureGenAwaitCatchTag(b *testing.B) {
	failing := effect.Gen(func(f *effect.Fiber) int { return effect.Await(f, effect.Fail[int](notFound{})) })
	recovered := effect.CatchTag(failing, func(notFound) effect.Effect[int] { return effect.Succeed(1) })
	e := effect.Gen(func(f *effect.Fiber) int {
		total := 0
		for range steps {
			total += effect.Await(f, recovered)
		}
		return total
	})
	for b.Loop() {
		effect.RunExit(ctx, e)
	}
}

// The same failure without a Gen body to unwind: no panic.
func BenchmarkFailureFlatMapCatchTag(b *testing.B) {
	recovered := effect.CatchTag(effect.Fail[int](notFound{}), func(notFound) effect.Effect[int] { return effect.Succeed(1) })
	e := effect.Gen(func(f *effect.Fiber) int {
		total := 0
		for range steps {
			total += effect.Await(f, recovered)
		}
		return total
	})
	for b.Loop() {
		effect.RunExit(ctx, e)
	}
}

// Try returns the failure as an error instead of unwinding.
func BenchmarkFailureTry(b *testing.B) {
	failing := effect.Fail[int](notFound{})
	e := effect.Gen(func(f *effect.Fiber) int {
		total := 0
		for range steps {
			if _, err := effect.Try(f, failing); errors.As(err, new(notFound)) {
				total++
			}
		}
		return total
	})
	for b.Loop() {
		effect.RunExit(ctx, e)
	}
}
