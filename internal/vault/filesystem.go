package vault

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func atomicWriteFile(path string, data []byte, perm os.FileMode) (err error) {
	return atomicWriteFileChecked(path, data, perm, "")
}

func createFileExclusive(path string, data []byte, perm os.FileMode) (err error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, perm)
	if err != nil {
		return err
	}
	defer func() {
		_ = file.Close()
		if err != nil {
			_ = os.Remove(path)
		}
	}()
	if _, err = file.Write(data); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	return file.Close()
}

func renameCaseOnly(from, to string) error {
	temp, err := os.CreateTemp(filepath.Dir(from), "."+filepath.Base(from)+".rename-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	if err := os.Remove(tempPath); err != nil {
		return err
	}
	if err := os.Rename(from, tempPath); err != nil {
		return err
	}
	if err := os.Rename(tempPath, to); err != nil {
		_ = os.Rename(tempPath, from)
		return err
	}
	return nil
}

func atomicWriteFileChecked(
	path string,
	data []byte,
	perm os.FileMode,
	expectedVersion string,
) (err error) {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = tmp.Close()
		if err != nil {
			_ = os.Remove(tmpName)
		}
	}()
	if err = tmp.Chmod(perm); err != nil {
		return err
	}
	if _, err = tmp.Write(data); err != nil {
		return err
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if expectedVersion != "" {
		current, readErr := os.ReadFile(path)
		if readErr != nil || contentVersion(current) != expectedVersion {
			return ErrConflict
		}
	}
	if err = replaceFile(tmpName, path); err != nil {
		return err
	}
	return nil
}

func contentVersion(data []byte) string {
	return fmt.Sprintf("%x", sha256.Sum256(data))
}

func ensureNoteOnlyDirectory(root string) error {
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing to delete directory containing a symlink: %s", path)
		}
		if !entry.IsDir() && !IsMarkdownPath(entry.Name()) {
			return fmt.Errorf("refusing to delete directory containing a non-note file: %s", path)
		}
		return nil
	})
}

func recoverBackup(path string) error {
	backup := path + ".rockion-backup"
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	info, err := os.Lstat(backup)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("invalid Rockion recovery backup")
	}
	return os.Rename(backup, path)
}

func replaceFile(tempPath, destination string) error {
	if err := os.Rename(tempPath, destination); err == nil {
		return nil
	}
	backup := destination + ".rockion-backup"
	_ = os.Remove(backup)
	if err := os.Rename(destination, backup); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(tempPath, destination); err != nil {
		_ = os.Rename(backup, destination)
		return err
	}
	_ = os.Remove(backup)
	return nil
}
