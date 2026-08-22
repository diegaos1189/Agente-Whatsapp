"use client";

import type { TransferAccountDTO } from "@pollos/shared";

const MAX_ACCOUNTS = 4;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function TransferAccountsEditor({
  value,
  onChange,
}: {
  value: TransferAccountDTO[];
  onChange: (next: TransferAccountDTO[]) => void;
}) {
  function updateAccount(index: number, patch: Partial<TransferAccountDTO>) {
    onChange(value.map((acc, i) => (i === index ? { ...acc, ...patch } : acc)));
  }

  function removeAccount(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function addAccount() {
    if (value.length >= MAX_ACCOUNTS) return;
    onChange([...value, { bankName: "", accountInfo: "", qrImage: null }]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {value.map((acc, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 10,
            border: "1px solid var(--border)",
            borderRadius: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Cuenta {i + 1}</span>
            <button type="button" className="danger" onClick={() => removeAccount(i)} style={{ padding: "2px 10px", fontSize: 11 }}>
              Quitar
            </button>
          </div>
          <label>
            Nombre del banco
            <input
              value={acc.bankName}
              onChange={(e) => updateAccount(i, { bankName: e.target.value })}
              placeholder="Ej: Bancolombia"
            />
          </label>
          <label>
            Numero de cuenta o llave
            <input
              value={acc.accountInfo}
              onChange={(e) => updateAccount(i, { accountInfo: e.target.value })}
              placeholder="Ej: Ahorros 123-456789-00 / Llave: 3001234567"
            />
          </label>
          <label>
            Foto del QR de pago (opcional)
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                updateAccount(i, { qrImage: await fileToDataUrl(file) });
              }}
            />
          </label>
          {acc.qrImage && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img
                src={acc.qrImage}
                alt="QR de pago"
                style={{ width: 100, height: 100, objectFit: "contain", border: "1px solid var(--border)", borderRadius: 8 }}
              />
              <button type="button" className="secondary" onClick={() => updateAccount(i, { qrImage: null })}>
                Quitar QR
              </button>
            </div>
          )}
        </div>
      ))}
      {value.length < MAX_ACCOUNTS && (
        <button type="button" className="secondary" onClick={addAccount} style={{ alignSelf: "flex-start" }}>
          + Agregar cuenta ({value.length}/{MAX_ACCOUNTS})
        </button>
      )}
    </div>
  );
}
