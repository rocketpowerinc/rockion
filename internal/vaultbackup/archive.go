package vaultbackup

import (
	"archive/zip"
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/scrypt"
)

const (
	chunkSize           = 1 << 20
	maxArchiveFiles     = 100_000
	maxUncompressedSize = 20 << 30
)

var archiveMagic = [8]byte{'R', 'O', 'C', 'K', 'I', 'O', 'N', '1'}

type manifest struct {
	Version   int    `json:"version"`
	VaultName string `json:"vaultName"`
}

// Export creates an encrypted Rockion archive at destination.
func Export(vaultRoot, destination, password string) (err error) {
	if len(password) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	root, err := filepath.Abs(vaultRoot)
	if err != nil {
		return err
	}
	tempZip, err := os.CreateTemp("", "rockion-export-*.zip")
	if err != nil {
		return err
	}
	tempZipPath := tempZip.Name()
	defer func() {
		_ = tempZip.Close()
		_ = os.Remove(tempZipPath)
	}()

	if err := writeVaultZip(tempZip, root); err != nil {
		return err
	}
	if err := tempZip.Close(); err != nil {
		return err
	}

	input, err := os.Open(tempZipPath)
	if err != nil {
		return err
	}
	defer input.Close()

	output, err := os.CreateTemp(filepath.Dir(destination), "."+filepath.Base(destination)+".tmp-*")
	if err != nil {
		return err
	}
	outputPath := output.Name()
	defer func() {
		_ = output.Close()
		if err != nil {
			_ = os.Remove(outputPath)
		}
	}()

	if err = encryptStream(output, input, password); err != nil {
		return err
	}
	if err = output.Sync(); err != nil {
		return err
	}
	if err = output.Close(); err != nil {
		return err
	}
	if err = replaceFile(outputPath, destination); err != nil {
		return err
	}
	return nil
}

// Import decrypts an archive into a new child directory under destinationParent.
// It returns the path to the imported vault.
func Import(source, destinationParent, password string) (vaultPath string, err error) {
	if len(password) < 8 {
		return "", errors.New("password must be at least 8 characters")
	}
	input, err := os.Open(source)
	if err != nil {
		return "", err
	}
	defer input.Close()

	tempZip, err := os.CreateTemp("", "rockion-import-*.zip")
	if err != nil {
		return "", err
	}
	tempZipPath := tempZip.Name()
	defer func() {
		_ = tempZip.Close()
		_ = os.Remove(tempZipPath)
	}()
	if err := decryptStream(tempZip, input, password); err != nil {
		return "", err
	}
	if err := tempZip.Close(); err != nil {
		return "", err
	}

	reader, err := zip.OpenReader(tempZipPath)
	if err != nil {
		return "", errors.New("decrypted data is not a valid Rockion vault")
	}
	defer reader.Close()

	var meta manifest
	if err := json.Unmarshal([]byte(reader.Comment), &meta); err != nil || meta.Version != 1 {
		return "", errors.New("archive metadata is missing or unsupported")
	}
	name := safeVaultName(meta.VaultName)
	target, err := uniqueDestination(destinationParent, name)
	if err != nil {
		return "", err
	}
	if err := os.Mkdir(target, 0o755); err != nil {
		return "", err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(target)
		}
	}()
	if err := extractVaultZip(&reader.Reader, target); err != nil {
		return "", err
	}
	return target, nil
}

func writeVaultZip(output io.Writer, root string) error {
	writer := zip.NewWriter(output)
	meta, err := json.Marshal(manifest{Version: 1, VaultName: filepath.Base(root)})
	if err != nil {
		return err
	}
	if err := writer.SetComment(string(meta)); err != nil {
		return err
	}
	walkErr := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("vault contains a symlink, which cannot be exported safely: %s", path)
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if isGeneratedIndex(rel) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !entry.IsDir() && !info.Mode().IsRegular() {
			return fmt.Errorf("vault contains an unsupported special file: %s", path)
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = rel
		if entry.IsDir() {
			header.Name += "/"
			_, err = writer.CreateHeader(header)
			return err
		}
		header.Method = zip.Deflate
		zipEntry, err := writer.CreateHeader(header)
		if err != nil {
			return err
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(zipEntry, file)
		closeErr := file.Close()
		return errors.Join(copyErr, closeErr)
	})
	if walkErr != nil {
		_ = writer.Close()
		return walkErr
	}
	return writer.Close()
}

func extractVaultZip(reader *zip.Reader, target string) error {
	if len(reader.File) > maxArchiveFiles {
		return errors.New("archive contains too many files")
	}
	var total uint64
	for _, file := range reader.File {
		total += file.UncompressedSize64
		if total > maxUncompressedSize {
			return errors.New("archive expands beyond the 20 GB safety limit")
		}
		clean := filepath.Clean(filepath.FromSlash(file.Name))
		if clean == "." || filepath.IsAbs(clean) || filepath.VolumeName(clean) != "" ||
			clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return fmt.Errorf("archive contains an unsafe path: %s", file.Name)
		}
		if file.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("archive contains a symlink: %s", file.Name)
		}
		full := filepath.Join(target, clean)
		relative, relErr := filepath.Rel(target, full)
		if relErr != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return fmt.Errorf("archive path escapes the destination: %s", file.Name)
		}
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(full, 0o755); err != nil {
				return err
			}
			continue
		}
		if !file.Mode().IsRegular() {
			return fmt.Errorf("archive contains an unsupported special file: %s", file.Name)
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return err
		}
		source, err := file.Open()
		if err != nil {
			return err
		}
		mode := os.FileMode(0o644)
		if file.Mode()&0o111 != 0 {
			mode = 0o755
		}
		destination, err := os.OpenFile(full, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
		if err != nil {
			_ = source.Close()
			return err
		}
		written, copyErr := io.Copy(destination, io.LimitReader(source, int64(file.UncompressedSize64)+1))
		closeErr := destination.Close()
		sourceErr := source.Close()
		if err := errors.Join(copyErr, closeErr, sourceErr); err != nil {
			return err
		}
		if written != int64(file.UncompressedSize64) {
			return fmt.Errorf("archive entry has an invalid size: %s", file.Name)
		}
	}
	return nil
}

func encryptStream(output io.Writer, input io.Reader, password string) error {
	header := make([]byte, len(archiveMagic)+16+8)
	copy(header, archiveMagic[:])
	if _, err := rand.Read(header[len(archiveMagic):]); err != nil {
		return err
	}
	if _, err := output.Write(header); err != nil {
		return err
	}
	aead, err := archiveAEAD(password, header[len(archiveMagic):len(archiveMagic)+16])
	if err != nil {
		return err
	}
	prefix := header[len(archiveMagic)+16:]
	buffer := make([]byte, chunkSize)
	var counter uint32
	for {
		count, readErr := io.ReadFull(input, buffer)
		if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
			return readErr
		}
		if count > 0 {
			if err := writeChunk(output, aead, header, prefix, counter, 0, buffer[:count]); err != nil {
				return err
			}
			counter++
		}
		if errors.Is(readErr, io.EOF) || errors.Is(readErr, io.ErrUnexpectedEOF) {
			break
		}
	}
	return writeChunk(output, aead, header, prefix, counter, 1, nil)
}

func decryptStream(output io.Writer, input io.Reader, password string) error {
	header := make([]byte, len(archiveMagic)+16+8)
	if _, err := io.ReadFull(input, header); err != nil {
		return errors.New("file is not a Rockion vault archive")
	}
	if !bytes.Equal(header[:len(archiveMagic)], archiveMagic[:]) {
		return errors.New("file is not a supported Rockion vault archive")
	}
	aead, err := archiveAEAD(password, header[len(archiveMagic):len(archiveMagic)+16])
	if err != nil {
		return err
	}
	prefix := header[len(archiveMagic)+16:]
	for counter := uint32(0); ; counter++ {
		var frame [5]byte
		if _, err := io.ReadFull(input, frame[:]); err != nil {
			return errors.New("archive is truncated or corrupted")
		}
		kind := frame[0]
		size := binary.BigEndian.Uint32(frame[1:])
		if kind > 1 || size < uint32(aead.Overhead()) || size > chunkSize+uint32(aead.Overhead()) {
			return errors.New("archive contains an invalid encrypted chunk")
		}
		ciphertext := make([]byte, size)
		if _, err := io.ReadFull(input, ciphertext); err != nil {
			return errors.New("archive is truncated or corrupted")
		}
		plaintext, err := aead.Open(nil, chunkNonce(prefix, counter), ciphertext, chunkAAD(header, kind, counter))
		if err != nil {
			return errors.New("password is incorrect or the archive is corrupted")
		}
		if kind == 1 {
			if len(plaintext) != 0 {
				return errors.New("archive has an invalid final record")
			}
			var extra [1]byte
			if count, _ := input.Read(extra[:]); count != 0 {
				return errors.New("archive has unexpected trailing data")
			}
			return nil
		}
		if _, err := output.Write(plaintext); err != nil {
			return err
		}
	}
}

func writeChunk(
	output io.Writer,
	aead cipher.AEAD,
	header, prefix []byte,
	counter uint32,
	kind byte,
	plaintext []byte,
) error {
	ciphertext := aead.Seal(nil, chunkNonce(prefix, counter), plaintext, chunkAAD(header, kind, counter))
	var frame [5]byte
	frame[0] = kind
	binary.BigEndian.PutUint32(frame[1:], uint32(len(ciphertext)))
	if _, err := output.Write(frame[:]); err != nil {
		return err
	}
	_, err := output.Write(ciphertext)
	return err
}

func archiveAEAD(password string, salt []byte) (cipher.AEAD, error) {
	key, err := scrypt.Key([]byte(password), salt, 1<<17, 8, 1, 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	for i := range key {
		key[i] = 0
	}
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func chunkNonce(prefix []byte, counter uint32) []byte {
	nonce := make([]byte, 12)
	copy(nonce, prefix)
	binary.BigEndian.PutUint32(nonce[8:], counter)
	return nonce
}

func chunkAAD(header []byte, kind byte, counter uint32) []byte {
	aad := make([]byte, 0, len(header)+5)
	aad = append(aad, header...)
	aad = append(aad, kind)
	var count [4]byte
	binary.BigEndian.PutUint32(count[:], counter)
	return append(aad, count[:]...)
}

func isGeneratedIndex(rel string) bool {
	lower := strings.ToLower(filepath.ToSlash(rel))
	return lower == ".rockion/index.db" ||
		strings.HasPrefix(lower, ".rockion/index.db-")
}

func safeVaultName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			return '-'
		default:
			if r < 32 {
				return -1
			}
			return r
		}
	}, name)
	name = strings.Trim(name, ". ")
	if name == "" {
		return "Imported Rockion Vault"
	}
	runes := []rune(name)
	if len(runes) > 120 {
		name = string(runes[:120])
	}
	switch strings.ToUpper(name) {
	case "CON", "PRN", "AUX", "NUL",
		"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
		"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		name = "_" + name
	}
	return name
}

func uniqueDestination(parent, name string) (string, error) {
	parent, err := filepath.Abs(parent)
	if err != nil {
		return "", err
	}
	for number := 1; number < 10_000; number++ {
		candidate := filepath.Join(parent, name)
		if number > 1 {
			candidate = filepath.Join(parent, fmt.Sprintf("%s %d", name, number))
		}
		_, err := os.Lstat(candidate)
		if errors.Is(err, os.ErrNotExist) {
			return candidate, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", errors.New("could not choose a unique imported vault folder")
}

func replaceFile(tempPath, destination string) error {
	if err := os.Rename(tempPath, destination); err == nil {
		return nil
	}
	backup := destination + ".rockion-replaced"
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
