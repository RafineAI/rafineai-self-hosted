package provider

import (
	"bufio"
	"io"
	"strings"
)

// scanSSE reads a Server-Sent Events stream, invoking fn for each event with
// its (event, data) fields. fn returns false to stop early. Multi-line data
// fields are joined with newlines per the SSE spec.
func scanSSE(r io.Reader, fn func(event, data string) bool) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var event string
	var data strings.Builder

	dispatch := func() bool {
		if data.Len() == 0 && event == "" {
			return true
		}
		cont := fn(event, data.String())
		event = ""
		data.Reset()
		return cont
	}

	for sc.Scan() {
		line := sc.Text()
		if line == "" { // event boundary
			if !dispatch() {
				return sc.Err()
			}
			continue
		}
		if strings.HasPrefix(line, ":") { // comment/keep-alive
			continue
		}
		if strings.HasPrefix(line, "event:") {
			event = strings.TrimSpace(line[len("event:"):])
		} else if strings.HasPrefix(line, "data:") {
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimSpace(line[len("data:"):]))
		}
	}
	// Flush any trailing event with no terminating blank line.
	dispatch()
	return sc.Err()
}
