package ratelimit

import (
	"testing"
	"time"
)

func TestRPMWindow(t *testing.T) {
	l := New()
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	l.Now = func() time.Time { return now }

	lim := Limits{RPM: 2}
	for i := 0; i < 2; i++ {
		if ok, _ := l.Allow("u", lim); !ok {
			t.Fatalf("request %d should be allowed", i)
		}
	}
	if ok, reason := l.Allow("u", lim); ok || reason != "rate_limited" {
		t.Fatalf("3rd request should be rate_limited, got ok=%v reason=%s", ok, reason)
	}

	// After the window rolls over, requests are allowed again.
	now = now.Add(61 * time.Second)
	if ok, _ := l.Allow("u", lim); !ok {
		t.Fatal("request after window reset should be allowed")
	}
}

func TestDailyTokenQuota(t *testing.T) {
	l := New()
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	l.Now = func() time.Time { return now }

	lim := Limits{DailyTokens: 100}
	if ok, _ := l.Allow("u", lim); !ok {
		t.Fatal("first request under quota allowed")
	}
	l.AddTokens("u", 100) // hit the cap
	if ok, reason := l.Allow("u", lim); ok || reason != "quota_exceeded" {
		t.Fatalf("should be quota_exceeded, got ok=%v reason=%s", ok, reason)
	}

	// Next UTC day resets the budget.
	now = now.Add(24 * time.Hour)
	if ok, _ := l.Allow("u", lim); !ok {
		t.Fatal("quota should reset next day")
	}
}

func TestZeroLimitsUnlimited(t *testing.T) {
	l := New()
	for i := 0; i < 1000; i++ {
		if ok, _ := l.Allow("u", Limits{}); !ok {
			t.Fatal("zero limits must never block")
		}
	}
}

func TestPerUserIsolation(t *testing.T) {
	l := New()
	lim := Limits{RPM: 1}
	l.Allow("a", lim)
	if ok, _ := l.Allow("b", lim); !ok {
		t.Fatal("user b should not be affected by user a's usage")
	}
}
