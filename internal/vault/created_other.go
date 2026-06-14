//go:build !windows && !darwin

package vault

import "os"

// fileCreatedAt falls back to the modification time on platforms (e.g. Linux)
// where birth time isn't exposed through os.FileInfo without extra syscalls.
func fileCreatedAt(info os.FileInfo) int64 {
	return info.ModTime().UnixMilli()
}
