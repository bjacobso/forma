package crudusers

// The Go twin of conformance/effect-typescript/cases/crud-users/harness.ts:
// the same calls and the same assertions against the generated Go package.

import (
	"context"
	"fmt"
	"reflect"
	"testing"

	"github.com/bjacobso/forma/prototypes/effect-go/effect"
)

var idsTest = effect.LayerEffect("IdsTest", IdsTag, effect.Sync(func() Ids {
	next := 0
	return Ids{Next: effect.Sync(func() UserId {
		next++
		return UserId(fmt.Sprintf("user-%d", next))
	})}
}))

var appTest = effect.MergeAll("AppTest", UserRepoMemory, idsTest)

func TestCrudUsers(t *testing.T) {
	equal := func(label string, got, want any) {
		t.Helper()
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s: got %#v, want %#v", label, got, want)
		}
	}
	program := effect.Gen(func(f *effect.Fiber) effect.Unit {
		ada := effect.Await(f, CreateUser(NewUser{Name: "Ada", Email: "ada@example.com", Role: RoleAdmin}))
		equal("ada", ada, User{Id: "user-1", Name: "Ada", Email: "ada@example.com", Role: "admin"})
		effect.Await(f, CreateUser(NewUser{Name: "Grace", Email: "grace@example.com", Role: RoleAdmin}))
		effect.Await(f, CreateUser(NewUser{Name: "Linus", Email: "linus@example.com", Role: RoleMember}))

		duplicate := effect.Await(f, effect.Flip(CreateUser(NewUser{Name: "Ada 2", Email: "ada@example.com", Role: RoleMember})))
		equal("duplicate", duplicate, DuplicateEmail{Email: "ada@example.com"})

		invalid := effect.Await(f, effect.Flip(CreateUser(NewUser{Name: "  ", Email: "blank@example.com", Role: RoleMember})))
		equal("invalid", invalid, InvalidUser{Reason: "name is required"})
		badEmail := effect.Await(f, effect.Flip(CreateUser(NewUser{Name: "Bob", Email: "bob", Role: RoleMember})))
		equal("bad email tag", badEmail.(effect.Tagged).Tag(), "InvalidUser")
		equal("bad email", badEmail, InvalidUser{Reason: "email is invalid"})

		equal("get", effect.Await(f, GetUser("user-1")), ada)
		renamed := effect.Await(f, RenameUser("user-1", "Ada Lovelace"))
		equal("renamed", renamed.Name, "Ada Lovelace")
		equal("admins", effect.Await(f, AdminNames), []string{"Ada Lovelace <ada@example.com>", "Grace <grace@example.com>"})

		repo := UserRepoTag.Get(f)
		renamed.Nickname = effect.Some("Countess")
		effect.Await(f, repo.Save(renamed))
		equal("admins with nickname", effect.Await(f, AdminNames), []string{"Countess <ada@example.com>", "Grace <grace@example.com>"})

		effect.Await(f, DeleteUser("user-2"))
		missing := effect.Await(f, effect.Flip(GetUser("user-2")))
		equal("missing", missing, UserNotFound{Id: "user-2"})
		equal("missing message", missing.Error(), "UserNotFound {Id:user-2}")
		missingDelete := effect.Await(f, effect.Flip(DeleteUser("user-2")))
		equal("missing delete", missingDelete.(effect.Tagged).Tag(), "UserNotFound")

		equal("find or default", effect.Await(f, FindOrDefault("user-3", "nobody")), "Linus")
		equal("find or default fallback", effect.Await(f, FindOrDefault("user-9", "nobody")), "nobody")
		equal("find missing", effect.Await(f, repo.Find("user-9")).IsNone(), true)
		return effect.Unit{}
	})

	if _, err := effect.Run(context.Background(), effect.Provide(program, appTest)); err != nil {
		t.Fatal(err)
	}
}
