package effect

import "time"

// Schedule decides whether to recur and how long to wait first. It is a
// description; each Retry or Repeat starts its own state.
//
// This is a small subset of Effect's Schedule: the constructors Forma
// exposes plus the two ways of combining them.
type Schedule struct {
	start func() step
}

// step reports the delay before the next recurrence, or false to stop.
type step func(attempt int) (time.Duration, bool)

// Recurs recurs n times without delay.
func Recurs(n int) Schedule {
	return Schedule{start: func() step {
		return func(attempt int) (time.Duration, bool) { return 0, attempt <= n }
	}}
}

// Forever recurs without limit or delay.
var Forever = Schedule{start: func() step {
	return func(int) (time.Duration, bool) { return 0, true }
}}

// Spaced recurs forever, waiting d each time.
func Spaced(d time.Duration) Schedule {
	return Schedule{start: func() step {
		return func(int) (time.Duration, bool) { return d, true }
	}}
}

// Exponential recurs forever, waiting base, 2·base, 4·base, ...
func Exponential(base time.Duration) Schedule {
	return Schedule{start: func() step {
		return func(attempt int) (time.Duration, bool) {
			return base * time.Duration(int64(1)<<min(attempt-1, 62)), true
		}
	}}
}

// Both recurs while both schedules do, waiting the longer delay.
func (s Schedule) Both(other Schedule) Schedule {
	return Schedule{start: func() step {
		left, right := s.start(), other.start()
		return func(attempt int) (time.Duration, bool) {
			l, lok := left(attempt)
			r, rok := right(attempt)
			return max(l, r), lok && rok
		}
	}}
}

// Either recurs while either schedule does, waiting the shorter delay.
func (s Schedule) Either(other Schedule) Schedule {
	return Schedule{start: func() step {
		left, right := s.start(), other.start()
		return func(attempt int) (time.Duration, bool) {
			l, lok := left(attempt)
			r, rok := right(attempt)
			switch {
			case lok && rok:
				return min(l, r), true
			case lok:
				return l, true
			default:
				return r, rok
			}
		}
	}}
}

// Policy is the options object of Effect.retry and Effect.repeat. Times
// limits recurrences; Schedule, when set, supplies the delays.
type Policy struct {
	Times    int64
	Schedule Schedule
}

func (p Policy) schedule() Schedule {
	s := Forever
	if p.Schedule.start != nil {
		s = p.Schedule
	}
	if p.Times > 0 {
		s = s.Both(Recurs(int(p.Times)))
	}
	return s
}

// Retry runs e again after typed failures while the policy recurs. Defects
// and interruptions are not retried.
func Retry[A any](e Effect[A], policy Policy) Effect[A] {
	return Gen(func(f *Fiber) A {
		next := policy.schedule().start()
		for attempt := 1; ; attempt++ {
			value, cause := f.runLoop(e.node)
			if cause == nil {
				return as[A](value)
			}
			delay, again := next(attempt)
			if !cause.IsFailureOnly() || !again {
				panic(&failSignal{fiber: f, cause: cause})
			}
			Await(f, Sleep(delay))
		}
	})
}

// Repeat runs e once, then again while the policy recurs, and succeeds with
// the last value. A failure stops it.
func Repeat[A any](e Effect[A], policy Policy) Effect[A] {
	return Gen(func(f *Fiber) A {
		next := policy.schedule().start()
		value := Await(f, e)
		for attempt := 1; ; attempt++ {
			delay, again := next(attempt)
			if !again {
				return value
			}
			Await(f, Sleep(delay))
			value = Await(f, e)
		}
	})
}
