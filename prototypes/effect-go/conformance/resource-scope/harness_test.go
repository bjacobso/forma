package resourcescope

// The Go twin of conformance/effect-typescript/cases/resource-scope/harness.ts:
// release order on success, failure, and for a layer's own resource.

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/bjacobso/forma/prototypes/effect-go/effect"
)

var rows = []Row{{Region: "north", Amount: 120}, {Region: "south", Amount: 80}, {Region: "north", Amount: 30}}

func adapters() (*[]string, *effect.Layer) {
	events := &[]string{}
	record := func(event string) effect.Effect[effect.Unit] {
		return effect.Sync(func() effect.Unit {
			*events = append(*events, event)
			return effect.Unit{}
		})
	}
	pool := Pool{
		Open: func(name string) effect.Effect[Connection] {
			return effect.As(record("open "+name), Connection{Id: name})
		},
		Close: func(connection Connection) effect.Effect[effect.Unit] {
			return record("close " + connection.Id)
		},
		Query: func(connection Connection, sql string) effect.Effect[[]Row] {
			if strings.HasPrefix(sql, "broken") {
				return effect.Fail[[]Row](QueryFailed{Query: sql})
			}
			result := rows
			if strings.HasPrefix(sql, "insert") {
				result = []Row{}
			}
			return effect.As(record(fmt.Sprintf("query %s: %s", connection.Id, sql)), result)
		},
	}
	audit := Audit{Record: func(event string) effect.Effect[effect.Unit] { return record("audit " + event) }}
	return events, effect.MergeAll("Adapters", effect.LayerSucceed("Pool", PoolTag, pool), effect.LayerSucceed("Audit", AuditTag, audit))
}

func expectEvents(t *testing.T, got *[]string, want ...string) {
	t.Helper()
	if !reflect.DeepEqual(*got, want) {
		t.Fatalf("events:\n got  %q\n want %q", *got, want)
	}
}

func TestReleasesInReverseOnSuccess(t *testing.T) {
	events, layer := adapters()
	totals, err := effect.Run(context.Background(), effect.Provide(RegionalTotals("select"), layer))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(totals.Keys(), []string{"north", "south"}) || !reflect.DeepEqual(totals.Vals(), []int64{150, 80}) {
		t.Fatalf("totals %v %v", totals.Keys(), totals.Vals())
	}
	expectEvents(t, events,
		"open primary",
		"open replica",
		"query primary: select",
		"audit read 3 rows; replica replica idle",
		"close replica",
		"close primary",
		"audit report finished")
}

func TestReleasesInReverseOnFailure(t *testing.T) {
	events, layer := adapters()
	failure, err := effect.Run(context.Background(), effect.Flip(effect.Provide(RegionalTotals("broken select"), layer)))
	if err != nil || failure != (QueryFailed{Query: "broken select"}) {
		t.Fatalf("failure %v, %v", failure, err)
	}
	// Both connections are released even though the query failed.
	expectEvents(t, events, "open primary", "open replica", "close replica", "close primary", "audit report finished")
}

func TestLayerResourceLivesAsLongAsTheLayer(t *testing.T) {
	events, layer := adapters()
	program := effect.Gen(func(f *effect.Fiber) effect.Unit {
		if grand := effect.Await(f, Publish("select")); grand != 230 {
			t.Errorf("grand total %d", grand)
		}
		*events = append(*events, "published")
		store := ReportStoreTag.Get(f)
		return effect.Await(f, store.Save("audit", 1))
	})
	app := effect.ProvideMergeLayer("App", ReportStoreLive, layer)
	if _, err := effect.Run(context.Background(), effect.Provide(program, app)); err != nil {
		t.Fatal(err)
	}
	expectEvents(t, events,
		"open reports",
		"open primary",
		"open replica",
		"query primary: select",
		"audit read 3 rows; replica replica idle",
		"close replica",
		"close primary",
		"audit report finished",
		"query reports: insert grand-total 230",
		"audit publish attempted",
		"published",
		"query reports: insert audit 1",
		// The layer's connection is released when the layer is.
		"close reports")
}

func TestPublishFailureStillReleasesTheLayer(t *testing.T) {
	events, layer := adapters()
	failure, err := effect.Run(context.Background(), effect.Flip(effect.Provide(Publish("broken"), effect.ProvideMergeLayer("App", ReportStoreLive, layer))))
	if err != nil || failure.(effect.Tagged).Tag() != "QueryFailed" {
		t.Fatalf("failure %v, %v", failure, err)
	}
	if n := len(*events); n < 2 || (*events)[n-2] != "audit publish attempted" || (*events)[n-1] != "close reports" {
		t.Fatalf("events %q", *events)
	}
}
