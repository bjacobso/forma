package effect

// Layer builds services. Like Effect's layers, building is memoized by layer
// identity within one Provide, so a layer referenced twice in a graph is
// built once, and finalizers of scoped layers run when the Provide exits.
//
// Go cannot express a layer's input and output requirements in its type;
// Forma's checker verifies the wiring.
type Layer struct {
	name  string
	build func(f *Fiber, b *layerBuild, input *Context) *Context
}

type layerBuild struct {
	memo  map[*Layer]*Context
	scope *Scope
}

// Name is the layer's name, for diagnostics.
func (l *Layer) Name() string { return l.name }

func (b *layerBuild) get(f *Fiber, l *Layer, input *Context) *Context {
	if built, ok := b.memo[l]; ok {
		return built
	}
	built := l.build(f, b, input)
	b.memo[l] = built
	return built
}

// LayerSucceed provides an existing service value.
func LayerSucceed[S any](name string, tag Tag[S], service S) *Layer {
	return &Layer{name: name, build: func(*Fiber, *layerBuild, *Context) *Context {
		return Add(EmptyContext(), tag, service)
	}}
}

// LayerEffect builds a service with an effect that may use the layer's
// inputs and the Scope of the enclosing Provide.
func LayerEffect[S any](name string, tag Tag[S], build Effect[S]) *Layer {
	return &Layer{name: name, build: func(f *Fiber, b *layerBuild, input *Context) *Context {
		services := Add(input, ScopeTag, b.scope)
		service := Await(f, Locally(currentContext, services, build))
		return Add(EmptyContext(), tag, service)
	}}
}

// MergeAll builds every layer from the same inputs and merges their
// services. Layers are built in order.
func MergeAll(name string, layers ...*Layer) *Layer {
	return &Layer{name: name, build: func(f *Fiber, b *layerBuild, input *Context) *Context {
		out := EmptyContext()
		for _, l := range layers {
			out = out.Merge(b.get(f, l, input))
		}
		return out
	}}
}

// ProvideLayer feeds the services of deps to layer and keeps only layer's
// own services, as Layer.provide does.
func ProvideLayer(name string, layer *Layer, deps ...*Layer) *Layer {
	return &Layer{name: name, build: func(f *Fiber, b *layerBuild, input *Context) *Context {
		depServices := EmptyContext()
		for _, dep := range deps {
			depServices = depServices.Merge(b.get(f, dep, input))
		}
		return b.get(f, layer, input.Merge(depServices))
	}}
}

// ProvideMergeLayer is ProvideLayer that also keeps the dependencies'
// services, as Layer.provideMerge does.
func ProvideMergeLayer(name string, layer *Layer, deps ...*Layer) *Layer {
	return &Layer{name: name, build: func(f *Fiber, b *layerBuild, input *Context) *Context {
		depServices := EmptyContext()
		for _, dep := range deps {
			depServices = depServices.Merge(b.get(f, dep, input))
		}
		return depServices.Merge(b.get(f, layer, input.Merge(depServices)))
	}}
}

// Provide builds layer and runs e with its services. The layer's scope
// closes when e exits, so scoped resources live exactly as long as e.
func Provide[A any](e Effect[A], layer *Layer) Effect[A] {
	return wrap[A](&opSuspend{thunk: func() node {
		scope := NewScope()
		b := &layerBuild{memo: map[*Layer]*Context{}, scope: scope}
		withServices := &opGen{body: func(f *Fiber) any {
			outer := currentContext.GetIn(f)
			built := b.get(f, layer, outer)
			return Await(f, Locally(currentContext, outer.Merge(built), e))
		}}
		return &opOnExit{first: withServices, onExit: func(exit ExitAny) node { return scope.closeNode(exit) }}
	}})
}

// BuildLayer builds a layer into a context inside the current Scope, for
// callers that manage the scope themselves.
func BuildLayer(layer *Layer) Effect[*Context] {
	return wrap[*Context](&opGen{body: func(f *Fiber) any {
		b := &layerBuild{memo: map[*Layer]*Context{}, scope: ScopeTag.Get(f)}
		return b.get(f, layer, currentContext.GetIn(f))
	}})
}
