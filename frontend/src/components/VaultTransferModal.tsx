import { useEffect, useRef, useState } from "react";

interface Props {
  mode: "export" | "import";
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}

export default function VaultTransferModal({ mode, onSubmit, onClose }: Props) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (submitting) return;
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (mode === "export" && password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(password);
      setPassword("");
      setConfirmation("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="switcher-overlay"
      role="presentation"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="vault-transfer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-transfer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="vault-transfer-title">
          {mode === "export" ? "Export Encrypted Vault" : "Import Encrypted Vault"}
        </h2>
        <p>
          {mode === "export"
            ? "Choose a password to encrypt the entire vault. Rockion cannot recover a forgotten password."
            : "Enter the password used when this vault was exported."}
        </p>
        <label>
          Password
          <input
            ref={inputRef}
            type="password"
            autoComplete={mode === "export" ? "new-password" : "current-password"}
            value={password}
            disabled={submitting}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && mode === "import") {
                event.preventDefault();
                void submit();
              } else if (event.key === "Escape" && !submitting) {
                onClose();
              }
            }}
          />
        </label>
        {mode === "export" && (
          <label>
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              disabled={submitting}
              onChange={(event) => setConfirmation(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                } else if (event.key === "Escape" && !submitting) {
                  onClose();
                }
              }}
            />
          </label>
        )}
        {error && <div className="vault-transfer-error">{error}</div>}
        <div className="new-page-actions">
          <button className="ghost" disabled={submitting} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={submitting} onClick={() => void submit()}>
            {submitting
              ? mode === "export"
                ? "Encrypting…"
                : "Decrypting…"
              : mode === "export"
                ? "Choose Save Location"
                : "Import Vault"}
          </button>
        </div>
      </div>
    </div>
  );
}
