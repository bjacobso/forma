package operationaleffects

// The Go twin of conformance/effect-typescript/cases/operational-effects/harness.ts.

import (
	"context"
	"reflect"
	"testing"

	"github.com/bjacobso/forma/prototypes/effect-go/effect"
)

func TestOperationalEffects(t *testing.T) {
	ctx := context.Background()

	failure, err := effect.Run(ctx, effect.Flip(AlwaysFail("offline")))
	if err != nil || failure != (ConsoleUnavailable{Message: "offline"}) {
		t.Fatalf("always-fail: %v, %v", failure, err)
	}

	if _, err := effect.Run(ctx, Recover("offline")); err != nil {
		t.Fatalf("recover: %v", err)
	}

	var printed []string
	consoleTest := effect.LayerSucceed("ConsoleTest", ConsoleTag, Console{Print: func(message string) effect.Effect[effect.Unit] {
		return effect.Sync(func() effect.Unit {
			printed = append(printed, message)
			return effect.Unit{}
		})
	}})
	if _, err := effect.Run(ctx, effect.Provide(Log("hello"), consoleTest)); err != nil {
		t.Fatalf("log: %v", err)
	}
	if !reflect.DeepEqual(printed, []string{"hello"}) {
		t.Fatalf("printed %v", printed)
	}

	consoleDown := effect.LayerSucceed("ConsoleDown", ConsoleTag, Console{Print: func(message string) effect.Effect[effect.Unit] {
		return effect.Fail[effect.Unit](ConsoleUnavailable{Message: message})
	}})
	down, err := effect.Run(ctx, effect.Flip(effect.Provide(Log("lost"), consoleDown)))
	if err != nil || down.(ConsoleUnavailable).Message != "lost" {
		t.Fatalf("console down: %v, %v", down, err)
	}
}
