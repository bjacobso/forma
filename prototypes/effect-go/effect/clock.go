package effect

import (
	"fmt"
	"log"
	"math/rand/v2"
	"sort"
	"strings"
	"sync"
	"time"
)

// Clock supplies the time and timers. Sleep, Timeout, and schedules read the
// current fiber's clock, so a TestClock controls them all.
type Clock interface {
	Now() time.Time
	// After returns a channel that becomes ready once d has elapsed, and a
	// function that releases the timer early.
	After(d time.Duration) (<-chan time.Time, func())
}

type liveClock struct{}

func (liveClock) Now() time.Time { return time.Now() }

func (liveClock) After(d time.Duration) (<-chan time.Time, func()) {
	timer := time.NewTimer(d)
	return timer.C, func() { timer.Stop() }
}

// LiveClock is the system clock. Inside a testing/synctest bubble its
// timers use the bubble's virtual time.
var LiveClock Clock = liveClock{}

var currentClock = NewFiberRef("Clock", LiveClock)

// WithClock runs e with a different clock.
func WithClock[A any](clock Clock, e Effect[A]) Effect[A] { return Locally(currentClock, clock, e) }

// Now reads the current fiber's clock.
var Now = wrap[time.Time](&opWithFiber{f: func(f *Fiber) node {
	return &opSucceed{value: currentClock.GetIn(f).Now()}
}})

// Sleep suspends the fiber for d. It is interruptible.
func Sleep(d time.Duration) Effect[Unit] {
	return wrap[Unit](&opBlock{run: func(f *Fiber) (any, *Cause) {
		if d <= 0 {
			return Unit{}, nil
		}
		ready, stop := currentClock.GetIn(f).After(d)
		defer stop()
		if !f.interruptible {
			<-ready
			return Unit{}, nil
		}
		select {
		case <-ready:
			return Unit{}, nil
		case <-f.interruptCh:
			return nil, f.deliverInterrupt()
		}
	}})
}

// TestClock is a clock whose time only moves when a test adjusts it, like
// Effect's TestClock. Adjust wakes due sleepers in deadline order; use
// testing/synctest.Wait to wait until the woken fibers have run.
type TestClock struct {
	mu       sync.Mutex
	now      time.Time
	sleepers []*sleeper
}

type sleeper struct {
	deadline time.Time
	ready    chan time.Time
	stopped  bool
}

// NewTestClock makes a test clock starting at start.
func NewTestClock(start time.Time) *TestClock { return &TestClock{now: start} }

// Now is the clock's current time.
func (c *TestClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

// After registers a sleeper that wakes when the clock reaches now+d.
func (c *TestClock) After(d time.Duration) (<-chan time.Time, func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := &sleeper{deadline: c.now.Add(d), ready: make(chan time.Time, 1)}
	if d <= 0 {
		s.ready <- c.now
		return s.ready, func() {}
	}
	c.sleepers = append(c.sleepers, s)
	return s.ready, func() {
		c.mu.Lock()
		s.stopped = true
		c.mu.Unlock()
	}
}

// Adjust moves time forward by d and wakes every sleeper that is due.
func (c *TestClock) Adjust(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	var due, pending []*sleeper
	for _, s := range c.sleepers {
		switch {
		case s.stopped:
		case !s.deadline.After(c.now):
			due = append(due, s)
		default:
			pending = append(pending, s)
		}
	}
	c.sleepers = pending
	c.mu.Unlock()
	sort.SliceStable(due, func(i, j int) bool { return due[i].deadline.Before(due[j].deadline) })
	for _, s := range due {
		s.ready <- s.deadline
	}
}

// Sleepers is the number of fibers waiting on the clock.
func (c *TestClock) Sleepers() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, s := range c.sleepers {
		if !s.stopped {
			n++
		}
	}
	return n
}

// Random is a source of random numbers; a seeded one makes tests repeatable.
type Random struct {
	mu  sync.Mutex
	rng *rand.Rand
}

// NewRandom makes a seeded random source.
func NewRandom(seed uint64) *Random {
	return &Random{rng: rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))}
}

var currentRandom = NewFiberRef("Random", NewRandom(uint64(time.Now().UnixNano())))

// WithRandom runs e with a different random source.
func WithRandom[A any](r *Random, e Effect[A]) Effect[A] { return Locally(currentRandom, r, e) }

// NextIntN succeeds with a random int in [0, n).
func NextIntN(n int) Effect[int] {
	return wrap[int](&opWithFiber{f: func(f *Fiber) node {
		r := currentRandom.GetIn(f)
		r.mu.Lock()
		defer r.mu.Unlock()
		return &opSucceed{value: r.rng.IntN(n)}
	}})
}

// Logger receives the messages of Log.
type Logger func(message string)

var currentLogger = NewFiberRef[Logger]("Logger", func(message string) { log.Print(message) })

// WithLogger runs e with a different logger.
func WithLogger[A any](logger Logger, e Effect[A]) Effect[A] {
	return Locally(currentLogger, logger, e)
}

// Log writes its arguments, separated by spaces, to the current logger.
func Log(parts ...any) Effect[Unit] {
	return wrap[Unit](&opWithFiber{f: func(f *Fiber) node {
		currentLogger.GetIn(f)(strings.TrimSuffix(fmt.Sprintln(parts...), "\n"))
		return unitNode
	}})
}
