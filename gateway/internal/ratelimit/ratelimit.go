// Package ratelimit enforces per-user request-rate and daily token quotas
// using in-RAM counters.
//
// Counters mutate per request, so (unlike the config snapshot) they live behind
// a mutex. Contention is negligible relative to upstream LLM latency. A zero
// limit means "unlimited" for that dimension.
package ratelimit

import (
	"sync"
	"time"
)

// Limits describes a user's caps. 0 disables that dimension.
type Limits struct {
	RPM         int // max requests per rolling 60s window
	DailyTokens int // max prompt+completion tokens per UTC day
}

type window struct {
	start time.Time
	count int
}

type dayCount struct {
	day    int // year*1000 + yearday
	tokens int
}

// Limiter tracks per-user request windows and daily token usage.
type Limiter struct {
	mu   sync.Mutex
	reqs map[string]*window
	toks map[string]*dayCount
	Now  func() time.Time
}

// New returns an empty Limiter.
func New() *Limiter {
	return &Limiter{
		reqs: map[string]*window{},
		toks: map[string]*dayCount{},
		Now:  time.Now,
	}
}

func dayKey(t time.Time) int {
	u := t.UTC()
	return u.Year()*1000 + u.YearDay()
}

// Allow checks both dimensions and, if permitted, consumes one request slot.
// It returns ok=false with a machine-readable reason when blocked.
func (l *Limiter) Allow(userID string, lim Limits) (ok bool, reason string) {
	now := l.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	// Daily token quota (pre-check; tokens are added later via AddTokens).
	if lim.DailyTokens > 0 {
		dc := l.toks[userID]
		if dc == nil || dc.day != dayKey(now) {
			dc = &dayCount{day: dayKey(now)}
			l.toks[userID] = dc
		}
		if dc.tokens >= lim.DailyTokens {
			return false, "quota_exceeded"
		}
	}

	// Request rate (rolling fixed 60s window).
	if lim.RPM > 0 {
		w := l.reqs[userID]
		if w == nil || now.Sub(w.start) >= time.Minute {
			w = &window{start: now}
			l.reqs[userID] = w
		}
		if w.count >= lim.RPM {
			return false, "rate_limited"
		}
		w.count++
	}
	return true, ""
}

// AddTokens records token usage toward the user's daily quota.
func (l *Limiter) AddTokens(userID string, n int) {
	if n <= 0 {
		return
	}
	now := l.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	dc := l.toks[userID]
	if dc == nil || dc.day != dayKey(now) {
		dc = &dayCount{day: dayKey(now)}
		l.toks[userID] = dc
	}
	dc.tokens += n
}
