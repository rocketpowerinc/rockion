//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func startDetachedUpdateHelper(scriptPath string, arguments ...string) error {
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		return errors.New("SystemRoot is not set")
	}
	powerShell := filepath.Join(
		systemRoot,
		"System32",
		"WindowsPowerShell",
		"v1.0",
		"powershell.exe",
	)
	args := []string{
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		scriptPath,
	}
	args = append(args, arguments...)
	command := exec.Command(powerShell, args...)
	command.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}
