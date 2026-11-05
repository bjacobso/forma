package shop

// The Go twin of conformance/effect-typescript/cases/http-api/harness.ts.
// The request cases live in wire-cases.json, which the cross-host check
// (cross-host.ts) also runs against the TypeScript server.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/bjacobso/forma/prototypes/effect-go/effect"
	"github.com/bjacobso/forma/prototypes/effect-go/httpapi"
)

type wireCase struct {
	Name   string          `json:"name"`
	Method string          `json:"method"`
	Path   string          `json:"path"`
	Body   string          `json:"body"`
	Status int             `json:"status"`
	JSON   json.RawMessage `json:"json"`
}

// Repository is the harness's UserRepo: "missing" is not found.
var Repository = effect.LayerSucceed("UserRepoTest", UserRepoTag, UserRepo{Find: func(id UserId) effect.Effect[User] {
	if id == "missing" {
		return effect.Fail[User](UserNotFound{Id: id})
	}
	return effect.Succeed(User{Id: id, Name: "Ada"})
}})

func TestWireCases(t *testing.T) {
	data, err := os.ReadFile("wire-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []wireCase `json:"cases"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	server, err := httpapi.NewServer(Shop, Repository, ShopUsersLive, ShopSystemLive)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range file.Cases {
		t.Run(c.Name, func(t *testing.T) {
			request := httptest.NewRequest(c.Method, c.Path, strings.NewReader(c.Body))
			if c.Body != "" {
				request.Header.Set("Content-Type", "application/json")
			}
			response := httptest.NewRecorder()
			server.ServeHTTP(response, request)
			body, _ := io.ReadAll(response.Body)
			if response.Code != c.Status {
				t.Fatalf("status %d, want %d (body %q)", response.Code, c.Status, body)
			}
			if string(c.JSON) == "null" {
				if len(body) != 0 {
					t.Fatalf("body %q, want empty", body)
				}
				return
			}
			var got, want any
			if err := json.Unmarshal(body, &got); err != nil {
				t.Fatalf("body %q: %v", body, err)
			}
			_ = json.Unmarshal(c.JSON, &want)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("body %s, want %s", body, c.JSON)
			}
			if ct := response.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("content type %q", ct)
			}
		})
	}
}

// Error bodies list "_tag" first, as Effect's do.
func TestErrorBodyStartsWithTag(t *testing.T) {
	server, _ := httpapi.NewServer(Shop, Repository, ShopUsersLive, ShopSystemLive)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest("GET", "/users/missing", nil))
	if got := response.Body.String(); got != `{"_tag":"UserNotFound","id":"missing"}` {
		t.Fatalf("body %s", got)
	}
}

// A handler for a request whose client has gone is interrupted, and its
// finalizers run: the request context is the fiber's.
func TestClientDisconnectInterruptsTheHandler(t *testing.T) {
	finalized := make(chan struct{})
	slow := effect.LayerSucceed("SlowRepo", UserRepoTag, UserRepo{Find: func(UserId) effect.Effect[User] {
		return effect.OnInterrupt(effect.Never[User](), effect.Sync(func() effect.Unit { close(finalized); return effect.Unit{} }))
	}})
	server, _ := httpapi.NewServer(Shop, slow, ShopUsersLive, ShopSystemLive)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		server.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/users/ada", nil).WithContext(ctx))
		close(done)
	}()
	time.Sleep(10 * time.Millisecond)
	cancel()
	select {
	case <-finalized:
	case <-time.After(time.Second):
		t.Fatal("the handler was not interrupted")
	}
	<-done
}

func TestEveryEndpointNeedsAHandler(t *testing.T) {
	if _, err := httpapi.NewServer(Shop, Repository, ShopUsersLive); err == nil || !strings.Contains(err.Error(), "system.health") {
		t.Fatalf("err = %v", err)
	}
}

var _ http.Handler = (*httpapi.Server)(nil)
