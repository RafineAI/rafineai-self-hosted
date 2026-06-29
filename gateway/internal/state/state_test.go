package state

import (
	"sync"
	"testing"
)

func TestStoreReplaceAndCurrent(t *testing.T) {
	s := New()
	if len(s.Current().Providers) != 0 {
		t.Fatal("expected empty initial snapshot")
	}

	s.Replace(&Snapshot{
		Providers:  map[string]Provider{"p1": {ID: "p1", Type: "openai", Active: true}},
		UserTokens: map[string]string{"u1:p1": "tok"},
		Blocked:    map[string]struct{}{"k-bad": {}},
	})

	snap := s.Current()
	if p, ok := snap.Provider("p1"); !ok || p.Type != "openai" {
		t.Fatal("provider lookup failed")
	}
	if tok, ok := snap.UserToken("u1", "p1"); !ok || tok != "tok" {
		t.Fatal("user token lookup failed")
	}
	if !snap.IsBlocked("k-bad") {
		t.Fatal("expected k-bad to be blocked")
	}
	if snap.IsBlocked("k-ok") {
		t.Fatal("did not expect k-ok to be blocked")
	}
}

func TestReplaceNilIsSafe(t *testing.T) {
	s := New()
	s.Replace(nil)
	if s.Current() == nil {
		t.Fatal("Current must never be nil")
	}
}

// Exercise concurrent readers + a writer to catch races under `go test -race`.
func TestConcurrentAccess(t *testing.T) {
	s := New()
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				_ = s.Current().IsBlocked("x")
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for j := 0; j < 1000; j++ {
			s.Replace(&Snapshot{Blocked: map[string]struct{}{"x": {}}})
		}
	}()
	wg.Wait()
}
