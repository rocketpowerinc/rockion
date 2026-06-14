//go:build windows

package vault

import (
	"os"
	"syscall"
)

// fileCreatedAt returns the file's creation time in unix milliseconds.
func fileCreatedAt(info os.FileInfo) int64 {
	if d, ok := info.Sys().(*syscall.Win32FileAttributeData); ok {
		return d.CreationTime.Nanoseconds() / 1e6
	}
	return info.ModTime().UnixMilli()
}
