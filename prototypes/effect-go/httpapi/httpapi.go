// Package httpapi serves Forma's http-api prelude on Go's net/http: the Go
// counterpart of Effect 4's HttpApi for RFC 0023. Generated code builds an
// API from the prelude's `:go` emit hooks; Forma's linker has already checked
// every handler against its endpoint, so this package trusts the wiring.
//
// Responses follow Forma's wire encoding, which matches Effect's HttpApi:
// success is JSON with status 200, a declared error is its record plus
// "_tag" with the error's status, a request that does not decode is 400
// with an empty body, and an unknown route or method is 404 with an empty
// body.
//
// This is a prototype. It is not a supported Forma target.
package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strconv"
	"strings"

	"github.com/bjacobso/forma/prototypes/effect-go/effect"
)

// API is a named set of endpoint groups.
type API struct {
	Name   string
	Groups []*GroupSpec
}

// GroupSpec is a named set of endpoints.
type GroupSpec struct {
	Name      string
	Endpoints []*EndpointSpec
}

// EndpointSpec is one route and the errors it may answer with.
type EndpointSpec struct {
	Name   string
	Method string
	Path   string
	errors []ErrorSpec
}

// ErrorSpec maps a declared error type to its HTTP status.
type ErrorSpec struct {
	typ    reflect.Type
	status int
}

// New declares an API.
func New(name string, groups ...*GroupSpec) *API { return &API{Name: name, Groups: groups} }

// Group declares a group of endpoints.
func Group(name string, endpoints ...*EndpointSpec) *GroupSpec {
	return &GroupSpec{Name: name, Endpoints: endpoints}
}

// Endpoint declares a route. method is lower case, as the prelude writes it;
// path parameters are written :name.
func Endpoint(method, name, path string, errors ...ErrorSpec) *EndpointSpec {
	return &EndpointSpec{Name: name, Method: strings.ToUpper(method), Path: path, errors: errors}
}

// Error declares that an endpoint answers failures of E's type with status.
// The zero value only carries the type.
func Error[E error](zero E, status int) ErrorSpec {
	return ErrorSpec{typ: reflect.TypeOf(zero), status: status}
}

// HandlerSpec implements one endpoint with a Forma operation.
type HandlerSpec struct {
	endpoint string
	serve    func(w http.ResponseWriter, r *http.Request, params map[string]string, spec *EndpointSpec, services *effect.Layer)
}

// Handler binds an endpoint to an operation. Go infers Req and Res from the
// generated operation; Req's `params` field is decoded from the path and its
// `payload` field from the JSON body.
func Handler[Req, Res any](endpoint string, operation func(Req) effect.Effect[Res]) HandlerSpec {
	return HandlerSpec{endpoint: endpoint, serve: func(w http.ResponseWriter, r *http.Request, params map[string]string, spec *EndpointSpec, services *effect.Layer) {
		var request Req
		if err := decodeRequest(reflect.ValueOf(&request).Elem(), r, params); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		program := operation(request)
		if services != nil {
			program = effect.Provide(program, services)
		}
		// The request's context is the fiber's: a client that goes away
		// interrupts the handler, and its finalizers run.
		exit := effect.RunExit(r.Context(), program)
		if value, ok := exit.Value(); ok {
			writeJSON(w, http.StatusOK, value)
			return
		}
		writeFailure(w, exit.Cause(), spec)
	}}
}

// GroupHandlers implements every endpoint of one group.
type GroupHandlers struct {
	api      *API
	group    string
	handlers []HandlerSpec
}

// Handle implements a group, like HttpApiBuilder.group.
func Handle(api *API, group string, handlers ...HandlerSpec) *GroupHandlers {
	return &GroupHandlers{api: api, group: group, handlers: handlers}
}

type route struct {
	spec     *EndpointSpec
	segments []string
	handler  HandlerSpec
}

// Server is an http.Handler for an API.
type Server struct {
	routes   []route
	services *effect.Layer
}

// NewServer serves api with the given group implementations. services, if
// not nil, is built for each request, like HttpRouter.provideRequest.
func NewServer(api *API, services *effect.Layer, groups ...*GroupHandlers) (*Server, error) {
	implemented := map[string]map[string]HandlerSpec{}
	for _, g := range groups {
		if g.api != api {
			return nil, fmt.Errorf("httpapi: group %s implements a different API", g.group)
		}
		implemented[g.group] = map[string]HandlerSpec{}
		for _, h := range g.handlers {
			implemented[g.group][h.endpoint] = h
		}
	}
	server := &Server{services: services}
	for _, group := range api.Groups {
		for _, endpoint := range group.Endpoints {
			handler, ok := implemented[group.Name][endpoint.Name]
			if !ok {
				return nil, fmt.Errorf("httpapi: %s.%s has no handler", group.Name, endpoint.Name)
			}
			server.routes = append(server.routes, route{spec: endpoint, segments: strings.Split(strings.Trim(endpoint.Path, "/"), "/"), handler: handler})
		}
	}
	return server, nil
}

// ServeHTTP routes by method and path. Unlike http.ServeMux, a known path
// with another method is 404, as in Effect's router.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	segments := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	for _, rt := range s.routes {
		if rt.spec.Method != r.Method || len(rt.segments) != len(segments) {
			continue
		}
		params := map[string]string{}
		matched := true
		for i, segment := range rt.segments {
			if name, ok := strings.CutPrefix(segment, ":"); ok {
				params[name] = segments[i]
			} else if segment != segments[i] {
				matched = false
				break
			}
		}
		if matched {
			rt.handler.serve(w, r, params, rt.spec, s.services)
			return
		}
	}
	w.WriteHeader(http.StatusNotFound)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func writeFailure(w http.ResponseWriter, cause *effect.Cause, spec *EndpointSpec) {
	if cause.IsInterruptedOnly() {
		// The client has gone; there is no one to answer.
		return
	}
	err, ok := cause.Failure()
	tagged, isTagged := err.(effect.Tagged)
	if !ok || !cause.IsFailureOnly() || !isTagged {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	status := http.StatusInternalServerError
	for _, declared := range spec.errors {
		if reflect.TypeOf(err) == declared.typ {
			status = declared.status
		}
	}
	fields, marshalErr := json.Marshal(err)
	if marshalErr != nil || len(fields) < 2 || fields[0] != '{' {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	tag, _ := json.Marshal(tagged.Tag())
	body := append([]byte(`{"_tag":`), tag...)
	if inner := bytes.TrimSpace(fields[1 : len(fields)-1]); len(inner) > 0 {
		body = append(append(body, ','), inner...)
	}
	body = append(body, '}')
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// decodeRequest fills the handler's request record: `params` from the path
// and `payload` from the body.
func decodeRequest(request reflect.Value, r *http.Request, params map[string]string) error {
	if request.Kind() != reflect.Struct {
		return nil
	}
	for i := range request.NumField() {
		field := request.Type().Field(i)
		switch jsonName(field) {
		case "params":
			if err := decodeParams(request.Field(i), params); err != nil {
				return err
			}
		case "payload":
			body, err := io.ReadAll(r.Body)
			if err != nil {
				return err
			}
			if err := decodeStrict(body, request.Field(i)); err != nil {
				return err
			}
		}
	}
	return nil
}

func decodeParams(target reflect.Value, params map[string]string) error {
	if target.Kind() != reflect.Struct {
		return errors.New("params must be a record")
	}
	for i := range target.NumField() {
		raw, ok := params[jsonName(target.Type().Field(i))]
		if !ok {
			return fmt.Errorf("missing path parameter %s", jsonName(target.Type().Field(i)))
		}
		field := target.Field(i)
		switch field.Kind() {
		case reflect.String:
			field.SetString(raw)
		case reflect.Int64:
			n, err := strconv.ParseInt(raw, 10, 64)
			if err != nil {
				return err
			}
			field.SetInt(n)
		case reflect.Float64:
			n, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				return err
			}
			field.SetFloat(n)
		case reflect.Bool:
			b, err := strconv.ParseBool(raw)
			if err != nil {
				return err
			}
			field.SetBool(b)
		default:
			return fmt.Errorf("unsupported path parameter type %s", field.Type())
		}
	}
	return nil
}

// decodeStrict decodes JSON the way Forma's wire encoding requires: every
// required record field must be present, optional fields (tagged
// omitzero) may be absent, extra fields are ignored, and types must match.
// encoding/json alone would accept missing fields.
func decodeStrict(data []byte, target reflect.Value) error {
	switch {
	case target.Kind() == reflect.Struct && !target.Addr().Type().Implements(unmarshalerType):
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
			return errors.New("expected an object")
		}
		for i := range target.NumField() {
			field := target.Type().Field(i)
			if !field.IsExported() {
				continue
			}
			raw, ok := fields[jsonName(field)]
			if !ok {
				if strings.Contains(field.Tag.Get("json"), "omitzero") {
					continue
				}
				return fmt.Errorf("missing field %s", jsonName(field))
			}
			if err := decodeStrict(raw, target.Field(i)); err != nil {
				return err
			}
		}
		return nil
	case target.Kind() == reflect.Slice && target.Type().Elem().Kind() == reflect.Struct:
		var items []json.RawMessage
		if err := json.Unmarshal(data, &items); err != nil {
			return err
		}
		slice := reflect.MakeSlice(target.Type(), len(items), len(items))
		for i, item := range items {
			if err := decodeStrict(item, slice.Index(i)); err != nil {
				return err
			}
		}
		target.Set(slice)
		return nil
	default:
		if string(bytes.TrimSpace(data)) == "null" && target.Kind() != reflect.Struct {
			return errors.New("unexpected null")
		}
		return json.Unmarshal(data, target.Addr().Interface())
	}
}

var unmarshalerType = reflect.TypeFor[json.Unmarshaler]()

func jsonName(field reflect.StructField) string {
	name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
	if name == "" {
		return field.Name
	}
	return name
}
