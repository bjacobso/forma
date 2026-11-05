package effect

import "time"

// Concurrency limits for ForEach and All. Sequential runs one effect at a
// time without forking; Unbounded forks one fiber per effect.
const (
	Unbounded  = 0
	Sequential = 1
)

// forEachNodes runs the effects with at most concurrency at once and
// succeeds with their values in order. The first failure interrupts the
// rest, and the result fails with every failure that was not an
// interruption caused by that.
func forEachNodes(effects []node, concurrency int) node {
	if concurrency == Sequential || len(effects) <= 1 {
		return &opGen{body: func(f *Fiber) any {
			values := make([]any, len(effects))
			for i, e := range effects {
				value, cause := f.runLoop(e)
				if cause != nil {
					panic(&failSignal{fiber: f, cause: cause})
				}
				values[i] = value
			}
			return values
		}}
	}
	return &opBlock{run: func(f *Fiber) (any, *Cause) {
		n := len(effects)
		workers := n
		if concurrency > 0 && concurrency < n {
			workers = concurrency
		}
		values := make([]any, n)
		causes := make([]*Cause, workers)
		finished := make(chan int, workers)
		next := make(chan int, n)
		for i := range n {
			next <- i
		}
		close(next)
		fibers := make([]*Fiber, workers)
		for w := range workers {
			fibers[w] = f.fork(&opGen{body: func(wf *Fiber) any {
				defer func() { finished <- w }()
				for i := range next {
					value, cause := wf.runLoop(effects[i])
					if cause != nil {
						causes[w] = cause
						return nil
					}
					values[i] = value
				}
				return nil
			}}, false)
		}
		interruptAll := func() {
			for _, worker := range fibers {
				worker.interruptAs(f.id)
			}
		}
		awaitAll := func() {
			for _, worker := range fibers {
				<-worker.done
			}
		}
		failed := false
		for remaining := workers; remaining > 0; remaining-- {
			var w int
			if f.interruptible {
				select {
				case w = <-finished:
				case <-f.interruptCh:
					interruptAll()
					awaitAll()
					return nil, f.deliverInterrupt()
				}
			} else {
				w = <-finished
			}
			if causes[w] != nil && !failed {
				failed = true
				interruptAll()
			}
		}
		awaitAll()
		if !failed {
			return values, nil
		}
		var combined *Cause
		for _, cause := range causes {
			if cause == nil {
				continue
			}
			for _, reason := range cause.Reasons() {
				if reason.Kind == ReasonInterrupt && reason.FiberID == f.id {
					continue
				}
				combined = combined.Combine(&Cause{reasons: []Reason{reason}})
			}
		}
		return nil, combined
	}}
}

// ForEach applies f to every item with bounded concurrency, keeping order.
func ForEach[A, B any](items []A, f func(A) Effect[B], concurrency int) Effect[[]B] {
	effects := make([]node, len(items))
	for i, item := range items {
		effects[i] = &opSuspend{thunk: func() node { return f(item).node }}
	}
	return wrap[[]B](&opFlatMap{first: forEachNodes(effects, concurrency), k: func(v any) node {
		values := v.([]any)
		out := make([]B, len(values))
		for i, value := range values {
			out[i] = as[B](value)
		}
		return &opSucceed{value: out}
	}})
}

// All runs effects of one type with bounded concurrency.
func All[A any](effects []Effect[A], concurrency int) Effect[[]A] {
	return ForEach(effects, func(e Effect[A]) Effect[A] { return e }, concurrency)
}

// All2 runs two effects with bounded concurrency.
func All2[A, B any](a Effect[A], b Effect[B], concurrency int) Effect[Tuple2[A, B]] {
	return wrap[Tuple2[A, B]](&opFlatMap{first: forEachNodes([]node{a.node, b.node}, concurrency), k: func(v any) node {
		values := v.([]any)
		return &opSucceed{value: Tuple2[A, B]{V1: as[A](values[0]), V2: as[B](values[1])}}
	}})
}

// All3 runs three effects with bounded concurrency.
func All3[A, B, C any](a Effect[A], b Effect[B], c Effect[C], concurrency int) Effect[Tuple3[A, B, C]] {
	return wrap[Tuple3[A, B, C]](&opFlatMap{first: forEachNodes([]node{a.node, b.node, c.node}, concurrency), k: func(v any) node {
		values := v.([]any)
		return &opSucceed{value: Tuple3[A, B, C]{V1: as[A](values[0]), V2: as[B](values[1]), V3: as[C](values[2])}}
	}})
}

// raceNodes forks every effect. With firstExit the first exit wins; without
// it the first success wins and the race fails only when all fail, with
// every cause. Losers are interrupted and awaited before the race returns.
func raceNodes(effects []node, firstExit bool) node {
	return &opBlock{run: func(f *Fiber) (any, *Cause) {
		exited := make(chan *Fiber, len(effects))
		fibers := make([]*Fiber, len(effects))
		for i, e := range effects {
			fibers[i] = f.fork(e, false)
			fibers[i].addObserver(func(child *Fiber) { exited <- child })
		}
		settle := func() {
			for _, fiber := range fibers {
				fiber.interruptAs(f.id)
			}
			for _, fiber := range fibers {
				<-fiber.done
			}
		}
		var failures *Cause
		for range effects {
			var child *Fiber
			if f.interruptible {
				select {
				case child = <-exited:
				case <-f.interruptCh:
					settle()
					return nil, f.deliverInterrupt()
				}
			} else {
				child = <-exited
			}
			if child.cause == nil || firstExit {
				settle()
				return child.value, child.cause
			}
			failures = failures.Combine(child.cause)
		}
		return nil, failures
	}}
}

// Race succeeds with the first effect to succeed and interrupts the other.
func Race[A any](a, b Effect[A]) Effect[A] {
	return wrap[A](raceNodes([]node{a.node, b.node}, false))
}

// RaceAll is Race over any number of effects.
func RaceAll[A any](effects ...Effect[A]) Effect[A] {
	nodes := make([]node, len(effects))
	for i, e := range effects {
		nodes[i] = e.node
	}
	return wrap[A](raceNodes(nodes, false))
}

// RaceFirst continues with whichever effect exits first, success or not.
func RaceFirst[A any](a, b Effect[A]) Effect[A] {
	return wrap[A](raceNodes([]node{a.node, b.node}, true))
}

// TimeoutOption interrupts e after d and succeeds with None.
func TimeoutOption[A any](e Effect[A], d time.Duration) Effect[Option[A]] {
	return RaceFirst(Map(e, Some[A]), As(Sleep(d), None[A]()))
}

// Timeout interrupts e after d and fails with TimeoutError.
func Timeout[A any](e Effect[A], d time.Duration) Effect[A] {
	return FlatMap(TimeoutOption(e, d), func(o Option[A]) Effect[A] {
		if value, ok := o.Get(); ok {
			return Succeed(value)
		}
		return Fail[A](TimeoutError{})
	})
}
