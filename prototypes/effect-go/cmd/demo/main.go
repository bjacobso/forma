// Command demo runs Go generated from Forma conformance programs on the
// effect-go runtime: the crud-users program with an in-memory repository,
// then the concurrent-workflow program with adapters that are slow, flaky,
// or broken.
package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	workflow "github.com/bjacobso/forma/prototypes/effect-go/conformance/concurrent-workflow"
	crudusers "github.com/bjacobso/forma/prototypes/effect-go/conformance/crud-users"
	"github.com/bjacobso/forma/prototypes/effect-go/effect"
)

func main() {
	if err := users(); err != nil {
		fmt.Fprintln(os.Stderr, "users:", err)
		os.Exit(1)
	}
	if err := dashboards(); err != nil {
		fmt.Fprintln(os.Stderr, "dashboards:", err)
		os.Exit(1)
	}
}

func users() error {
	fmt.Println("== crud-users ==")
	next := 0
	ids := effect.LayerSucceed("Ids", crudusers.IdsTag, crudusers.Ids{Next: effect.Sync(func() crudusers.UserId {
		next++
		return crudusers.UserId(fmt.Sprintf("user-%d", next))
	})})
	app := effect.MergeAll("App", crudusers.UserRepoMemory, ids)
	program := effect.Gen(func(f *effect.Fiber) effect.Unit {
		for _, input := range []crudusers.NewUser{
			{Name: "Ada", Email: "ada@example.com", Role: crudusers.RoleAdmin},
			{Name: "Grace", Email: "grace@example.com", Role: crudusers.RoleAdmin},
			{Name: "Linus", Email: "linus@example.com", Role: crudusers.RoleMember},
			{Name: "Ada again", Email: "ada@example.com", Role: crudusers.RoleMember},
			{Name: " ", Email: "blank@example.com", Role: crudusers.RoleMember},
		} {
			// Try returns the typed failure as an error, as hand-written Go would.
			user, err := effect.Try(f, crudusers.CreateUser(input))
			if err != nil {
				fmt.Printf("create %-10q failed: %v\n", input.Name, err)
				continue
			}
			fmt.Printf("create %-10q -> %s (%s)\n", input.Name, user.Id, user.Role)
		}
		effect.Await(f, crudusers.RenameUser("user-1", "Ada Lovelace"))
		fmt.Printf("admin names: %s\n", strings.Join(effect.Await(f, crudusers.AdminNames), ", "))
		effect.Await(f, crudusers.DeleteUser("user-2"))
		_, err := effect.Try(f, crudusers.GetUser("user-2"))
		fmt.Printf("get deleted user-2: %v\n", err)
		fmt.Printf("find-or-default user-9: %q\n", effect.Await(f, crudusers.FindOrDefault("user-9", "nobody")))
		return effect.Unit{}
	})
	_, err := effect.Run(context.Background(), effect.Provide(program, app))
	return err
}

func dashboards() error {
	fmt.Println("\n== concurrent-workflow ==")
	failures := map[string]int{"flaky": 2}
	profiles := workflow.Profiles{
		Fetch: func(id string) effect.Effect[workflow.Profile] {
			return effect.Gen(func(f *effect.Fiber) workflow.Profile {
				if failures[id] > 0 {
					failures[id]--
					fmt.Printf("  profiles.fetch %s: unavailable\n", id)
					return effect.Await(f, effect.Fail[workflow.Profile](workflow.Unavailable{Service: "profiles"}))
				}
				if id == "slow" {
					effect.Await(f, effect.Sleep(200*time.Millisecond))
				}
				return workflow.Profile{Id: id, Name: strings.ToUpper(id)}
			})
		},
		Cached: func(id string) effect.Effect[workflow.Profile] {
			return effect.AndThen(effect.Sleep(5*time.Millisecond), effect.Succeed(workflow.Profile{Id: id, Name: strings.ToUpper(id) + " (cached)"}))
		},
	}
	activities := workflow.Activities{Fetch: func(id string) effect.Effect[workflow.Activity] {
		delay := 10 * time.Millisecond
		if id == "slow" {
			delay = 200 * time.Millisecond
		}
		return effect.OnInterrupt(
			effect.AndThen(effect.Sleep(delay), effect.Succeed(workflow.Activity{Id: id, Events: int64(len(id))})),
			effect.Sync(func() effect.Unit { fmt.Printf("  activities.fetch %s: interrupted\n", id); return effect.Unit{} }))
	}}
	layer := effect.MergeAll("Adapters",
		effect.LayerSucceed("Profiles", workflow.ProfilesTag, profiles),
		effect.LayerSucceed("Activities", workflow.ActivitiesTag, activities))

	program := effect.Gen(func(f *effect.Fiber) effect.Unit {
		board := effect.Await(f, workflow.DashboardOp("flaky"))
		fmt.Printf("dashboard flaky (retried): %s, score %d\n", board.Profile.Name, board.Score)
		fastest := effect.Await(f, workflow.FastestProfile("slow"))
		fmt.Printf("fastest profile for slow: %s\n", fastest.Name)
		start := time.Now()
		within := effect.Await(f, workflow.DashboardWithin("slow", 30))
		fmt.Printf("dashboard slow within 30ms: some=%v after %v\n", within.IsSome(), time.Since(start).Round(10*time.Millisecond))
		start = time.Now()
		boards := effect.Await(f, workflow.Dashboards([]string{"a", "bb", "ccc", "dddd"}))
		fmt.Printf("4 dashboards, 2 at a time: %d boards in %v\n", len(boards), time.Since(start).Round(10*time.Millisecond))
		return effect.Unit{}
	})
	_, err := effect.Run(context.Background(), effect.Provide(program, layer))
	return err
}
