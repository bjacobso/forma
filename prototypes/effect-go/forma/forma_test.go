package forma

import (
	"strings"
	"testing"
)

func TestMapKeepsInsertionOrder(t *testing.T) {
	m := EmptyMap[int]()
	for i, key := range []string{"zeta", "alpha", "mid", "beta"} {
		m = m.Assoc(key, i)
	}
	m = m.Assoc("alpha", 10).Dissoc("mid")
	if got := strings.Join(m.Keys(), ","); got != "zeta,alpha,beta" {
		t.Fatalf("keys %s", got)
	}
	if got := m.Vals(); got[0] != 0 || got[1] != 10 || got[2] != 3 {
		t.Fatalf("vals %v", got)
	}
}

// JavaScript lists array-index keys first, in numeric order, then the rest
// in insertion order. The TypeScript target stores maps as objects, so the
// Go map reproduces that order.
func TestMapUsesJavaScriptPropertyOrder(t *testing.T) {
	m := EmptyMap[int]().Assoc("b", 1).Assoc("2", 2).Assoc("1", 3).Assoc("a", 4).Assoc("01", 5)
	if got := strings.Join(m.Keys(), ","); got != "1,2,b,a,01" {
		t.Fatalf("keys %s", got)
	}
}

func TestMapIsPersistent(t *testing.T) {
	base := EmptyMap[int]().Assoc("a", 1)
	left := base.Assoc("b", 2)
	right := base.Assoc("c", 3)
	if strings.Join(left.Keys(), ",") != "a,b" || strings.Join(right.Keys(), ",") != "a,c" || base.Len() != 1 {
		t.Fatalf("left %v right %v base %v", left.Keys(), right.Keys(), base.Keys())
	}
}

func TestJavaScriptStringSemantics(t *testing.T) {
	if got := Trim("\uFEFF hi \u0085"); got != "hi \u0085" {
		t.Fatalf("Trim = %q", got)
	}
	if got := Length("a😀"); got != 3 {
		t.Fatalf("Length = %d", got)
	}
	if got := Upcase("straße"); got != "STRASSE" {
		t.Fatalf("Upcase = %q", got)
	}
}

func TestFormatFloatMatchesJavaScript(t *testing.T) {
	tenth, fifth := 0.1, 0.2 // variables: constant arithmetic would be exact
	cases := map[float64]string{
		tenth + fifth: "0.30000000000000004",
		100:           "100",
		1e20:          "100000000000000000000",
		1e21:          "1e+21",
		1.5e-7:        "1.5e-7",
		-2.5:          "-2.5",
	}
	for input, want := range cases {
		if got := FormatFloat(input); got != want {
			t.Errorf("FormatFloat(%v) = %q, want %q", input, got, want)
		}
	}
}

func TestIntArithmeticStaysInTheSafeRange(t *testing.T) {
	if IntAdd(MaxInt-1, 1) != MaxInt {
		t.Fatal("add")
	}
	for name, overflow := range map[string]func(){
		"add": func() { IntAdd(MaxInt, 1) },
		"mul": func() { IntMul(1<<30, 1<<30) },
	} {
		func() {
			defer func() {
				if r := recover(); r != (IntRangeError{}) {
					t.Errorf("%s: recovered %v", name, r)
				}
			}()
			overflow()
		}()
	}
}
