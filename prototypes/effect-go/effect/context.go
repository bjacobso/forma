package effect

import "fmt"

type refKey struct {
	name    string
	initial any
}

// FiberRef is a fiber-local variable. A forked fiber starts with a copy of
// its parent's values.
type FiberRef[A any] struct {
	key *refKey
}

// NewFiberRef makes a fiber-local variable with an initial value.
func NewFiberRef[A any](name string, initial A) FiberRef[A] {
	return FiberRef[A]{key: &refKey{name: name, initial: initial}}
}

// GetIn reads the value in the given fiber.
func (r FiberRef[A]) GetIn(f *Fiber) A {
	if value, ok := f.refs[r.key]; ok {
		return as[A](value)
	}
	return as[A](r.key.initial)
}

// Get reads the current value.
func (r FiberRef[A]) Get() Effect[A] {
	return wrap[A](&opWithFiber{f: func(f *Fiber) node { return &opSucceed{value: r.GetIn(f)} }})
}

// Set replaces the current value for the rest of the fiber.
func (r FiberRef[A]) Set(value A) Effect[Unit] {
	return wrap[Unit](&opWithFiber{f: func(f *Fiber) node {
		f.setRef(r.key, value)
		return unitNode
	}})
}

// Locally runs e with the reference set to value, restoring it afterwards.
func Locally[A, B any](r FiberRef[A], value A, e Effect[B]) Effect[B] {
	return wrap[B](&opLocally{key: r.key, value: value, body: e.node})
}

// Fiber refs are copy-on-write: fork shares the map and the first write on
// either side copies it.
func (f *Fiber) setRef(key *refKey, value any) {
	if f.refsShared {
		refs := make(map[*refKey]any, len(f.refs)+1)
		for k, v := range f.refs {
			refs[k] = v
		}
		f.refs, f.refsShared = refs, false
	}
	f.refs[key] = value
}

func (f *Fiber) deleteRef(key *refKey) {
	if _, ok := f.refs[key]; !ok {
		return
	}
	f.setRef(key, nil)
	delete(f.refs, key)
}

type tagKey struct{ name string }

// Tag identifies a service of type S in a Context, like Effect's
// Context.Service key. Go cannot track which tags an effect needs; Forma's
// checker does.
type Tag[S any] struct {
	key *tagKey
}

// NewTag makes a service key.
func NewTag[S any](name string) Tag[S] { return Tag[S]{key: &tagKey{name: name}} }

// Name is the service name.
func (t Tag[S]) Name() string { return t.key.name }

// Get reads the service from the fiber's context. A missing service is a
// defect: in generated code the checker has proven it is provided.
func (t Tag[S]) Get(f *Fiber) S {
	value, ok := currentContext.GetIn(f).entries[t.key]
	if !ok {
		panic(MissingServiceError{Service: t.key.name})
	}
	return as[S](value)
}

// Effect reads the service as an effect.
func (t Tag[S]) Effect() Effect[S] {
	return wrap[S](&opWithFiber{f: func(f *Fiber) node { return &opSucceed{value: t.Get(f)} }})
}

// MissingServiceError is the defect raised when a service is not provided.
type MissingServiceError struct{ Service string }

func (e MissingServiceError) Error() string {
	return fmt.Sprintf("effect: service %s is not provided", e.Service)
}

// Context maps service tags to implementations. It is immutable.
type Context struct {
	entries map[*tagKey]any
}

var emptyContext = &Context{entries: map[*tagKey]any{}}

// EmptyContext is a context without services.
func EmptyContext() *Context { return emptyContext }

// Add returns a context that also holds service under tag.
func Add[S any](c *Context, tag Tag[S], service S) *Context {
	entries := make(map[*tagKey]any, len(c.entries)+1)
	for k, v := range c.entries {
		entries[k] = v
	}
	entries[tag.key] = service
	return &Context{entries: entries}
}

// Merge returns a context with the services of both; other wins.
func (c *Context) Merge(other *Context) *Context {
	if len(other.entries) == 0 {
		return c
	}
	if len(c.entries) == 0 {
		return other
	}
	entries := make(map[*tagKey]any, len(c.entries)+len(other.entries))
	for k, v := range c.entries {
		entries[k] = v
	}
	for k, v := range other.entries {
		entries[k] = v
	}
	return &Context{entries: entries}
}

var currentContext = NewFiberRef("Context", emptyContext)

// ProvideContext runs e with services added to the current context.
func ProvideContext[A any](e Effect[A], services *Context) Effect[A] {
	return wrap[A](&opWithFiber{f: func(f *Fiber) node {
		return &opLocally{key: currentContext.key, value: currentContext.GetIn(f).Merge(services), body: e.node}
	}})
}

// ProvideService runs e with one service added.
func ProvideService[A, S any](e Effect[A], tag Tag[S], service S) Effect[A] {
	return ProvideContext(e, Add(EmptyContext(), tag, service))
}

// CurrentContext reads the fiber's services.
func CurrentContext(f *Fiber) *Context { return currentContext.GetIn(f) }
