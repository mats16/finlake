import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

const SQL_WAREHOUSE_STORAGE_KEY = 'finlake.sqlWarehouseId';

interface SqlWarehouseContextValue {
  selectedWarehouseId: string | null;
  setSelectedWarehouseId: (warehouseId: string | null) => void;
}

const SqlWarehouseContext = createContext<SqlWarehouseContextValue | null>(null);

export function SqlWarehouseProvider({ children }: { children: ReactNode }) {
  const [selectedWarehouseId, setSelectedWarehouseIdState] = useState(readStoredWarehouseId);

  const value = useMemo<SqlWarehouseContextValue>(
    () => ({
      selectedWarehouseId,
      setSelectedWarehouseId: (warehouseId) => {
        const next = warehouseId?.trim() || null;
        if (next === selectedWarehouseId) return;
        setSelectedWarehouseIdState(next);
        persistWarehouseId(next);
      },
    }),
    [selectedWarehouseId],
  );

  return <SqlWarehouseContext.Provider value={value}>{children}</SqlWarehouseContext.Provider>;
}

export function useSelectedSqlWarehouse() {
  const context = useContext(SqlWarehouseContext);
  if (!context) {
    throw new Error('useSelectedSqlWarehouse must be used within SqlWarehouseProvider');
  }
  return context;
}

function readStoredWarehouseId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SQL_WAREHOUSE_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function persistWarehouseId(warehouseId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (warehouseId) {
      window.localStorage.setItem(SQL_WAREHOUSE_STORAGE_KEY, warehouseId);
    } else {
      window.localStorage.removeItem(SQL_WAREHOUSE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures; the in-memory selection still works for the session.
  }
}
