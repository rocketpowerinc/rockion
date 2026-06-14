//go:build darwin

package vault

import (
	"os"
	"syscall"
	"time"
)

// fileCreatedAt returns the file's birth time in unix milliseconds.
func fileCreatedAt(info os.FileInfo) int64 {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		return time.Unix(st.Birthtimespec.Sec, st.Birthtimespec.Nsec).UnixMilli()
	}
	return info.ModTime().UnixMilli()
}
