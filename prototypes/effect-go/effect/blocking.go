package effect

import "context"

// Blocking calls a Go function on the fiber's goroutine. Its context is
// cancelled when the fiber is interrupted, so a function that honours ctx
// returns early; one that ignores ctx delays the interruption until it
// returns. Inside an uninterruptible region the context is not cancelled.
// A returned error is a typed failure.
//
// This is how an extern that declares it honours cancellation is bound.
func Blocking[A any](call func(ctx context.Context) (A, error)) Effect[A] {
	return wrap[A](&opBlock{run: func(f *Fiber) (any, *Cause) {
		ctx := f.Context()
		if !f.interruptible {
			ctx = context.WithoutCancel(ctx)
		}
		value, err := call(ctx)
		if f.interruptible && f.isInterrupted() {
			return nil, f.deliverInterrupt()
		}
		if err != nil {
			return nil, FailCause(err)
		}
		return value, nil
	}})
}

// Detached calls a Go function on a helper goroutine. When the fiber is
// interrupted it stops waiting at once and abandons the call, which keeps
// running with a cancelled context. This matches how Effect abandons a
// pending promise, at the cost of a goroutine that may outlive the fiber.
func Detached[A any](call func(ctx context.Context) (A, error)) Effect[A] {
	type result struct {
		value A
		cause *Cause
	}
	return wrap[A](&opBlock{run: func(f *Fiber) (any, *Cause) {
		ctx := f.Context()
		if !f.interruptible {
			ctx = context.WithoutCancel(ctx)
		}
		results := make(chan result, 1)
		go func() {
			defer func() {
				if r := recover(); r != nil {
					results <- result{cause: recovered(nil, r)}
				}
			}()
			value, err := call(ctx)
			if err != nil {
				results <- result{cause: FailCause(err)}
				return
			}
			results <- result{value: value}
		}()
		if !f.interruptible {
			r := <-results
			return r.value, r.cause
		}
		select {
		case r := <-results:
			return r.value, r.cause
		case <-f.interruptCh:
			return nil, f.deliverInterrupt()
		}
	}})
}
