// Package forma holds the value-level helpers that generated Go calls:
// Forma's maps, lists, strings, and integers with the semantics the
// Effect TypeScript target has, so one program behaves the same on both
// hosts.
//
// This is a prototype for RFC 0019.
package forma

import (
	"cmp"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/bjacobso/forma/prototypes/effect-go/effect"
)

// Map is Forma's (Map String V): an immutable map that iterates in
// JavaScript's own-property order, because the Effect TypeScript target
// stores maps as objects: array-index keys ("0", "1", ...) first in numeric
// order, then other keys in insertion order. Go's built-in maps iterate in
// random order, so `keys`, `vals`, and `find` would otherwise differ
// between hosts.
type Map[V any] struct {
	keys   []string
	values map[string]V
}

// EmptyMap is a map without entries.
func EmptyMap[V any]() Map[V] { return Map[V]{} }

// MapOf builds a map from alternating keys and values in order.
func MapOf[V any](entries ...effect.Tuple2[string, V]) Map[V] {
	m := EmptyMap[V]()
	for _, entry := range entries {
		m = m.Assoc(entry.V1, entry.V2)
	}
	return m
}

// Get looks a key up.
func (m Map[V]) Get(key string) effect.Option[V] {
	if value, ok := m.values[key]; ok {
		return effect.Some(value)
	}
	return effect.None[V]()
}

// Has reports whether the key is present.
func (m Map[V]) Has(key string) bool {
	_, ok := m.values[key]
	return ok
}

// Assoc returns a map with key set. An existing key keeps its position.
func (m Map[V]) Assoc(key string, value V) Map[V] {
	values := make(map[string]V, len(m.values)+1)
	for k, v := range m.values {
		values[k] = v
	}
	keys := m.keys
	if _, ok := m.values[key]; !ok {
		keys = append(slices.Clip(m.keys), key)
	}
	values[key] = value
	return Map[V]{keys: keys, values: values}
}

// Dissoc returns a map without key.
func (m Map[V]) Dissoc(key string) Map[V] {
	if !m.Has(key) {
		return m
	}
	values := make(map[string]V, len(m.values))
	keys := make([]string, 0, len(m.keys))
	for _, k := range m.keys {
		if k != key {
			keys = append(keys, k)
			values[k] = m.values[k]
		}
	}
	return Map[V]{keys: keys, values: values}
}

// Keys returns the keys in JavaScript property order.
func (m Map[V]) Keys() []string {
	var indices, names []string
	for _, k := range m.keys {
		if isArrayIndex(k) {
			indices = append(indices, k)
		} else {
			names = append(names, k)
		}
	}
	if len(indices) == 0 {
		return names
	}
	slices.SortFunc(indices, func(a, b string) int {
		x, _ := strconv.ParseUint(a, 10, 32)
		y, _ := strconv.ParseUint(b, 10, 32)
		return cmp.Compare(x, y)
	})
	return append(indices, names...)
}

// isArrayIndex reports whether JavaScript treats key as an array index:
// a canonical decimal below 2^32 - 1.
func isArrayIndex(key string) bool {
	if key == "" || len(key) > 10 || (len(key) > 1 && key[0] == '0') {
		return false
	}
	n, err := strconv.ParseUint(key, 10, 32)
	return err == nil && n < math.MaxUint32
}

// Vals returns the values in key order.
func (m Map[V]) Vals() []V {
	keys := m.Keys()
	out := make([]V, len(keys))
	for i, k := range keys {
		out[i] = m.values[k]
	}
	return out
}

// Len is the number of entries.
func (m Map[V]) Len() int { return len(m.keys) }

// ListMap is Forma's `map` over a list.
func ListMap[A, B any](f func(A) B, xs []A) []B {
	out := make([]B, len(xs))
	for i, x := range xs {
		out[i] = f(x)
	}
	return out
}

// ListFilter is Forma's `filter`.
func ListFilter[A any](keep func(A) bool, xs []A) []A {
	out := make([]A, 0, len(xs))
	for _, x := range xs {
		if keep(x) {
			out = append(out, x)
		}
	}
	return out
}

// ListFind is Forma's `find`: the first match, if any.
func ListFind[A any](match func(A) bool, xs []A) effect.Option[A] {
	for _, x := range xs {
		if match(x) {
			return effect.Some(x)
		}
	}
	return effect.None[A]()
}

// Conj appends without sharing the input's backing array.
func Conj[A any](xs []A, x A) []A { return append(slices.Clip(xs), x) }

// The largest integer Forma's Int holds: JavaScript's safe-integer range,
// which the Effect TypeScript target enforces.
const (
	MaxInt = 1<<53 - 1
	MinInt = -MaxInt
)

// IntRangeError is the defect raised when Int arithmetic leaves the safe
// range, matching the TypeScript target's RangeError.
type IntRangeError struct{}

func (IntRangeError) Error() string { return "Int outside the safe integer range" }

// CheckInt panics with IntRangeError outside the safe range.
func CheckInt(n int64) int64 {
	if n > MaxInt || n < MinInt {
		panic(IntRangeError{})
	}
	return n
}

// IntAdd adds within the safe range.
func IntAdd(a, b int64) int64 { return CheckInt(a + b) }

// IntSub subtracts within the safe range.
func IntSub(a, b int64) int64 { return CheckInt(a - b) }

// IntMul multiplies within the safe range. Operands are already in range,
// so the float product decides overflow before int64 could wrap.
func IntMul(a, b int64) int64 {
	if p := float64(a) * float64(b); p > MaxInt || p < MinInt {
		panic(IntRangeError{})
	}
	return a * b
}

// Millis converts Forma's millisecond counts to a duration; plain numbers
// passed as durations are milliseconds, as in Effect.
func Millis(n float64) time.Duration { return time.Duration(n * float64(time.Millisecond)) }

// Seconds converts seconds to a duration.
func Seconds(n float64) time.Duration { return time.Duration(n * float64(time.Second)) }

// Minutes converts minutes to a duration.
func Minutes(n float64) time.Duration { return time.Duration(n * float64(time.Minute)) }

// Trim removes leading and trailing whitespace as String.prototype.trim
// does. JavaScript and Go disagree on U+FEFF (trimmed by JavaScript) and
// U+0085 (trimmed by Go's strings.TrimSpace).
func Trim(s string) string { return strings.TrimFunc(s, isJSWhitespace) }

func isJSWhitespace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x00A0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

// Length is a string's length in UTF-16 code units, as JavaScript counts
// it. len(s) counts UTF-8 bytes.
func Length(s string) int64 {
	n := int64(0)
	for _, r := range s {
		n += int64(utf16.RuneLen(r))
	}
	return n
}

// Upcase is String.prototype.toUpperCase for the cases Go's per-rune
// mapping misses (ß becomes SS).
func Upcase(s string) string {
	return strings.ReplaceAll(strings.ToUpper(s), "ß", "SS")
}

// Downcase is String.prototype.toLowerCase.
func Downcase(s string) string { return strings.ToLower(s) }

// ToString renders a value as JavaScript's String() does for the types
// Forma has. Floats use the shortest round-tripping digits.
func ToString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		return FormatFloat(x)
	case bool:
		return strconv.FormatBool(x)
	case fmt.Stringer:
		return x.String()
	default:
		return fmt.Sprint(x)
	}
}

// FormatFloat formats a number like JavaScript's Number::toString:
// integers below 1e21 print without an exponent.
func FormatFloat(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	}
	abs := math.Abs(f)
	if abs >= 1e-6 && abs < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	s := strconv.FormatFloat(f, 'e', -1, 64)
	mantissa, exponent, _ := strings.Cut(s, "e")
	exponent = strings.TrimLeft(exponent, "+")
	sign := "+"
	if strings.HasPrefix(exponent, "-") {
		sign, exponent = "-", exponent[1:]
	}
	return mantissa + "e" + sign + strings.TrimLeft(exponent, "0")
}

// With returns a copy of v changed by update: Forma's `assoc` on a record,
// which Go cannot write as an expression.
func With[T any](v T, update func(*T)) T {
	update(&v)
	return v
}

// ErrorString renders a tagged error and its fields for Error(). fields
// must not implement error itself, or formatting it would recurse.
func ErrorString(tag string, fields any) string {
	return fmt.Sprintf("%s %+v", tag, fields)
}

// Reduce folds a list from the left.
func Reduce[A, B any](f func(B, A) B, init B, xs []A) B {
	acc := init
	for _, x := range xs {
		acc = f(acc, x)
	}
	return acc
}

// SumInt adds Ints within the safe range.
func SumInt(xs []int64) int64 {
	total := int64(0)
	for _, x := range xs {
		total = IntAdd(total, x)
	}
	return total
}

// SumFloat adds Floats.
func SumFloat(xs []float64) float64 {
	total := 0.0
	for _, x := range xs {
		total += x
	}
	return total
}

// First is the first item, if any.
func First[A any](xs []A) effect.Option[A] {
	if len(xs) == 0 {
		return effect.None[A]()
	}
	return effect.Some(xs[0])
}

// Concat joins two lists without sharing either backing array.
func Concat[A any](xs, ys []A) []A { return append(slices.Clip(slices.Clone(xs)), ys...) }

// MarshalJSON encodes the map as an object in key order.
func (m Map[V]) MarshalJSON() ([]byte, error) {
	var b strings.Builder
	b.WriteByte('{')
	for i, k := range m.Keys() {
		if i > 0 {
			b.WriteByte(',')
		}
		key, _ := json.Marshal(k)
		value, err := json.Marshal(m.values[k])
		if err != nil {
			return nil, err
		}
		b.Write(key)
		b.WriteByte(':')
		b.Write(value)
	}
	b.WriteByte('}')
	return []byte(b.String()), nil
}
