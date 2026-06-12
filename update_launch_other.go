//go:build !windows

package main

import "errors"

func startDetachedUpdateHelper(string, ...string) error {
	return errors.New("automatic updates are only available on Windows")
}
