package effect

import "sync"

// Ref is a mutable reference updated atomically, like Effect's Ref.
type Ref[A any] struct {
	mu    sync.Mutex
	value A
}

// MakeRef makes a reference.
func MakeRef[A any](initial A) Effect[*Ref[A]] {
	return Sync(func() *Ref[A] { return &Ref[A]{value: initial} })
}

// Get reads the value.
func (r *Ref[A]) Get() Effect[A] {
	return Sync(func() A {
		r.mu.Lock()
		defer r.mu.Unlock()
		return r.value
	})
}

// Set replaces the value.
func (r *Ref[A]) Set(value A) Effect[Unit] {
	return Sync(func() Unit {
		r.mu.Lock()
		r.value = value
		r.mu.Unlock()
		return Unit{}
	})
}

// Update applies f atomically.
func (r *Ref[A]) Update(f func(A) A) Effect[Unit] {
	return Sync(func() Unit {
		r.mu.Lock()
		defer r.mu.Unlock()
		r.value = f(r.value)
		return Unit{}
	})
}

// Modify applies f atomically and succeeds with its first result.
func Modify[A, B any](r *Ref[A], f func(A) (B, A)) Effect[B] {
	return Sync(func() B {
		r.mu.Lock()
		defer r.mu.Unlock()
		out, next := f(r.value)
		r.value = next
		return out
	})
}

// Deferred is a value set once and awaited by any number of fibers.
type Deferred[A any] struct {
	once  sync.Once
	done  chan struct{}
	value A
	cause *Cause
}

// MakeDeferred makes an empty deferred.
func MakeDeferred[A any]() Effect[*Deferred[A]] {
	return Sync(func() *Deferred[A] { return &Deferred[A]{done: make(chan struct{})} })
}

func (d *Deferred[A]) complete(value A, cause *Cause) bool {
	completed := false
	d.once.Do(func() {
		d.value, d.cause, completed = value, cause, true
		close(d.done)
	})
	return completed
}

// Succeed completes the deferred; it reports whether this call completed it.
func (d *Deferred[A]) Succeed(value A) Effect[bool] {
	return Sync(func() bool { return d.complete(value, nil) })
}

// Fail completes the deferred with a typed failure.
func (d *Deferred[A]) Fail(err error) Effect[bool] {
	return Sync(func() bool {
		var zero A
		return d.complete(zero, FailCause(err))
	})
}

// Await waits for completion. It is interruptible.
func (d *Deferred[A]) Await() Effect[A] {
	return wrap[A](&opBlock{run: func(f *Fiber) (any, *Cause) {
		if f.wait(d.done) {
			return nil, f.deliverInterrupt()
		}
		return d.value, d.cause
	}})
}

// Queue is a bounded FIFO queue backed by a channel. Offer waits while it
// is full and Take while it is empty; both are interruptible.
type Queue[A any] struct {
	items chan A
}

// MakeQueue makes a queue holding up to capacity items.
func MakeQueue[A any](capacity int) Effect[*Queue[A]] {
	return Sync(func() *Queue[A] { return &Queue[A]{items: make(chan A, capacity)} })
}

// Offer adds an item, waiting for space.
func (q *Queue[A]) Offer(item A) Effect[Unit] {
	return wrap[Unit](&opBlock{run: func(f *Fiber) (any, *Cause) {
		if !f.interruptible {
			q.items <- item
			return Unit{}, nil
		}
		select {
		case q.items <- item:
			return Unit{}, nil
		case <-f.interruptCh:
			return nil, f.deliverInterrupt()
		}
	}})
}

// Take removes the oldest item, waiting for one.
func (q *Queue[A]) Take() Effect[A] {
	return wrap[A](&opBlock{run: func(f *Fiber) (any, *Cause) {
		if !f.interruptible {
			return <-q.items, nil
		}
		select {
		case item := <-q.items:
			return item, nil
		case <-f.interruptCh:
			return nil, f.deliverInterrupt()
		}
	}})
}

// Size is the number of queued items.
func (q *Queue[A]) Size() Effect[int] { return Sync(func() int { return len(q.items) }) }

// Semaphore limits concurrent access to n permits.
type Semaphore struct {
	permits chan struct{}
}

// MakeSemaphore makes a semaphore with n permits.
func MakeSemaphore(n int) Effect[*Semaphore] {
	return Sync(func() *Semaphore { return &Semaphore{permits: make(chan struct{}, n)} })
}

func (s *Semaphore) acquire(f *Fiber, n int) *Cause {
	for acquired := 0; acquired < n; acquired++ {
		if !f.interruptible {
			s.permits <- struct{}{}
			continue
		}
		select {
		case s.permits <- struct{}{}:
		case <-f.interruptCh:
			s.release(acquired)
			return f.deliverInterrupt()
		}
	}
	return nil
}

func (s *Semaphore) release(n int) {
	for range n {
		<-s.permits
	}
}

// WithPermits runs e holding n permits, releasing them however e exits.
// Waiting for permits is interruptible. Permits are taken one at a time, so
// callers asking for several can starve each other; Effect's semaphore is
// fair and this one is not.
func WithPermits[A any](s *Semaphore, n int, e Effect[A]) Effect[A] {
	return UninterruptibleMask(func(restore Restore) Effect[A] {
		acquire := wrap[Unit](&opBlock{run: func(f *Fiber) (any, *Cause) {
			if cause := s.acquire(f, n); cause != nil {
				return nil, cause
			}
			return Unit{}, nil
		}})
		return AndThen(Restored(restore, acquire), Ensuring(Restored(restore, e), Sync(func() Unit {
			s.release(n)
			return Unit{}
		})))
	})
}

// PubSub broadcasts each published item to every current subscriber.
// Subscribers get bounded queues; a full subscriber makes Publish wait.
type PubSub[A any] struct {
	mu          sync.Mutex
	capacity    int
	subscribers map[*Queue[A]]struct{}
}

// MakePubSub makes a hub whose subscribers buffer capacity items.
func MakePubSub[A any](capacity int) Effect[*PubSub[A]] {
	return Sync(func() *PubSub[A] {
		return &PubSub[A]{capacity: capacity, subscribers: map[*Queue[A]]struct{}{}}
	})
}

// Subscribe adds a subscriber for the life of the current Scope.
func (p *PubSub[A]) Subscribe() Effect[*Queue[A]] {
	return AcquireRelease(
		Sync(func() *Queue[A] {
			q := &Queue[A]{items: make(chan A, p.capacity)}
			p.mu.Lock()
			p.subscribers[q] = struct{}{}
			p.mu.Unlock()
			return q
		}),
		func(q *Queue[A], _ ExitAny) Effect[Unit] {
			return Sync(func() Unit {
				p.mu.Lock()
				delete(p.subscribers, q)
				p.mu.Unlock()
				return Unit{}
			})
		})
}

// Publish offers item to every subscriber.
func (p *PubSub[A]) Publish(item A) Effect[Unit] {
	return Gen(func(f *Fiber) Unit {
		p.mu.Lock()
		queues := make([]*Queue[A], 0, len(p.subscribers))
		for q := range p.subscribers {
			queues = append(queues, q)
		}
		p.mu.Unlock()
		for _, q := range queues {
			Await(f, q.Offer(item))
		}
		return Unit{}
	})
}
