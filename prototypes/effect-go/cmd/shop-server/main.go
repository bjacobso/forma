// Command shop-server serves the Go generated from the http-api conformance
// program, with the harness's repository, on a free local port. It prints
// the base URL on its first line; cross-host.ts uses it.
package main

import (
	"fmt"
	"net"
	"net/http"
	"os"

	shop "github.com/bjacobso/forma/prototypes/effect-go/conformance/http-api"
	"github.com/bjacobso/forma/prototypes/effect-go/effect"
	"github.com/bjacobso/forma/prototypes/effect-go/httpapi"
)

func main() {
	repository := effect.LayerSucceed("UserRepoTest", shop.UserRepoTag, shop.UserRepo{Find: func(id shop.UserId) effect.Effect[shop.User] {
		if id == "missing" {
			return effect.Fail[shop.User](shop.UserNotFound{Id: id})
		}
		return effect.Succeed(shop.User{Id: id, Name: "Ada"})
	}})
	server, err := httpapi.NewServer(shop.Shop, repository, shop.ShopUsersLive, shop.ShopSystemLive)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("http://%s\n", listener.Addr())
	if err := http.Serve(listener, server); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
