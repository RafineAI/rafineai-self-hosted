// Package state holds the gateway's in-RAM view of provider config,
// per-user OAuth tokens, and the revocation blocklist.
//
// The whole view is an immutable Snapshot swapped atomically (lock-free).
// Readers on the hot path call Current() and never block; the background
// sync worker builds a fresh Snapshot and Store()s it.
package state

import "sync/atomic"

// Provider is the decrypted, ready-to-use view of an llm_providers row.
type Provider struct {
	ID           string
	Name         string
	Type         string // openai | anthropic | gemini
	AuthMode     string // api_key | oauth2
	APIKey       string // decrypted; empty for oauth2 providers
	BaseURL      string
	DefaultModel string
	Active       bool

	// Smart routing (optional): when both LightModel and HeavyModel are set,
	// the gateway routes by estimated prompt size around RouteThreshold tokens.
	LightModel     string
	HeavyModel     string
	RouteThreshold int
}

// Snapshot is an immutable, point-in-time view of all gateway state.
type Snapshot struct {
	Providers map[string]Provider // by provider id
	// UserTokens holds decrypted OAuth access tokens keyed by "userID:providerID".
	UserTokens map[string]string
	// Blocked is the set of revoked key ids (kid).
	Blocked map[string]struct{}
}

// Store wraps an atomic pointer to the current Snapshot.
type Store struct {
	ptr atomic.Pointer[Snapshot]
}

// New returns a Store seeded with an empty snapshot.
func New() *Store {
	s := &Store{}
	s.ptr.Store(emptySnapshot())
	return s
}

// Current returns the live snapshot. Safe for concurrent hot-path reads.
func (s *Store) Current() *Snapshot {
	return s.ptr.Load()
}

// Replace atomically swaps in a new snapshot.
func (s *Store) Replace(snap *Snapshot) {
	if snap == nil {
		snap = emptySnapshot()
	}
	s.ptr.Store(snap)
}

// Provider looks up a provider by id in the current snapshot.
func (s *Snapshot) Provider(id string) (Provider, bool) {
	p, ok := s.Providers[id]
	return p, ok
}

// UserToken returns the decrypted OAuth token for a user+provider pair.
func (s *Snapshot) UserToken(userID, providerID string) (string, bool) {
	t, ok := s.UserTokens[userID+":"+providerID]
	return t, ok
}

// IsBlocked reports whether a key id has been revoked.
func (s *Snapshot) IsBlocked(kid string) bool {
	_, ok := s.Blocked[kid]
	return ok
}

func emptySnapshot() *Snapshot {
	return &Snapshot{
		Providers:  map[string]Provider{},
		UserTokens: map[string]string{},
		Blocked:    map[string]struct{}{},
	}
}
