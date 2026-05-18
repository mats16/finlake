import { useEffect } from 'react';
import {
  Badge,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  cn,
} from '@databricks/appkit-ui/react';
import { Circle, CircleOff, LoaderCircle } from 'lucide-react';
import { useSqlWarehouses } from '../api/hooks';
import { useSelectedSqlWarehouse } from '../contexts/SqlWarehouseContext';
import { useI18n, type TFunction } from '../i18n';

interface SqlWarehouseSelectorProps {
  triggerClassName?: string;
}

export function SqlWarehouseSelector({ triggerClassName }: SqlWarehouseSelectorProps = {}) {
  const { t } = useI18n();
  const warehouses = useSqlWarehouses();
  const { selectedWarehouseId, setSelectedWarehouseId } = useSelectedSqlWarehouse();
  const items = warehouses.data?.items ?? [];
  const groups = warehouseGroups(items, t);
  const selectedExists = selectedWarehouseId
    ? items.some((warehouse) => warehouse.id === selectedWarehouseId)
    : true;

  const defaultWarehouseId = warehouses.data?.defaultWarehouseId ?? null;

  useEffect(() => {
    if (!warehouses.isSuccess || !defaultWarehouseId) return;
    if (!selectedWarehouseId || !selectedExists) {
      setSelectedWarehouseId(defaultWarehouseId);
    }
  }, [
    defaultWarehouseId,
    selectedExists,
    selectedWarehouseId,
    setSelectedWarehouseId,
    warehouses.isSuccess,
  ]);

  const value = selectedExists && selectedWarehouseId ? selectedWarehouseId : defaultWarehouseId;
  const disabled = warehouses.isLoading || warehouses.isError || !value;

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(next) => setSelectedWarehouseId(next)}
      disabled={disabled}
    >
      <SelectTrigger
        className={cn(
          triggerClassName ?? 'w-[280px]',
          '[&_.warehouse-detail-badge]:hidden [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1',
        )}
        aria-label={t('sqlWarehouse.label')}
      >
        <SelectValue
          placeholder={
            warehouses.isLoading ? t('sqlWarehouse.loading') : t('sqlWarehouse.noneAvailable')
          }
        />
      </SelectTrigger>
      <SelectContent align="end" className="w-[min(520px,calc(100vw-2rem))]">
        {groups.map((group) => (
          <SelectGroup key={group.key}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.items.map((warehouse) => (
              <SelectItem
                key={warehouse.id}
                value={warehouse.id}
                className="pr-2 pl-8 [&>span:first-child]:right-auto [&>span:first-child]:left-2 [&>span:last-child]:w-full [&>span:last-child]:min-w-0"
              >
                <WarehouseOption
                  name={warehouse.name}
                  isDefault={warehouse.isDefault}
                  state={warehouse.state}
                  clusterSize={warehouse.clusterSize}
                  mode={warehouseMode(
                    warehouse.enableServerlessCompute,
                    warehouse.warehouseType,
                    t,
                  )}
                  t={t}
                />
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

type WarehouseItem = NonNullable<ReturnType<typeof useSqlWarehouses>['data']>['items'][number];

function warehouseGroups(items: WarehouseItem[], t: TFunction) {
  const definitions = [
    { key: 'serverless', label: t('sqlWarehouse.serverlessSection') },
    { key: 'pro', label: t('sqlWarehouse.proSection') },
    { key: 'classic', label: t('sqlWarehouse.classicSection') },
    { key: 'other', label: t('sqlWarehouse.otherSection') },
  ];

  return definitions
    .map((definition) => ({
      ...definition,
      items: items.filter((warehouse) => warehouseGroupKey(warehouse) === definition.key),
    }))
    .filter((group) => group.items.length > 0);
}

function warehouseGroupKey(warehouse: WarehouseItem) {
  if (warehouse.enableServerlessCompute) return 'serverless';
  if (warehouse.warehouseType === 'PRO') return 'pro';
  if (warehouse.warehouseType === 'CLASSIC') return 'classic';
  return 'other';
}

function WarehouseOption({
  name,
  isDefault,
  state,
  clusterSize,
  mode,
  t,
}: {
  name: string;
  isDefault: boolean;
  state: string | null;
  clusterSize: string | null;
  mode: string | null;
  t: TFunction;
}) {
  return (
    <span className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_2.25rem] items-center gap-2">
      <WarehouseStateIcon state={state} t={t} />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate">{name}</span>
        {isDefault ? (
          <Badge
            variant="secondary"
            className="warehouse-detail-badge shrink-0 px-1.5 py-0 text-[10px]"
          >
            {t('sqlWarehouse.defaultBadge')}
          </Badge>
        ) : null}
        {mode ? (
          <Badge
            variant="secondary"
            className="warehouse-detail-badge shrink-0 px-1.5 py-0 text-[10px]"
          >
            {mode}
          </Badge>
        ) : null}
      </span>
      <span className="flex justify-end">
        {clusterSize ? (
          <Badge variant="outline" className="w-9 justify-center px-1.5 py-0 text-[10px]">
            {warehouseSizeLabel(clusterSize)}
          </Badge>
        ) : null}
      </span>
    </span>
  );
}

function WarehouseStateIcon({ state, t }: { state: string | null; t: TFunction }) {
  if (state === 'RUNNING') {
    return (
      <Circle
        className="size-3 fill-(--success) text-(--success)"
        aria-label={t('sqlWarehouse.running')}
      />
    );
  }

  if (state === 'STOPPED') {
    return (
      <CircleOff
        className="size-3.5 text-muted-foreground"
        aria-label={t('sqlWarehouse.stopped')}
      />
    );
  }

  if (state === 'STARTING') {
    return (
      <LoaderCircle
        className="size-3.5 animate-spin text-muted-foreground"
        aria-label={t('sqlWarehouse.starting')}
      />
    );
  }

  if (!state) return null;

  return (
    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
      {state}
    </Badge>
  );
}

function warehouseMode(
  enableServerlessCompute: boolean,
  warehouseType: string | null,
  t: TFunction,
): string | null {
  if (enableServerlessCompute) return t('sqlWarehouse.serverless');
  if (!warehouseType || warehouseType === 'TYPE_UNSPECIFIED') return null;
  if (warehouseType === 'PRO') return 'Pro';
  if (warehouseType === 'CLASSIC') return 'Classic';
  return warehouseType;
}

function warehouseSizeLabel(clusterSize: string) {
  const normalized = clusterSize.toLowerCase();
  const labels: Record<string, string> = {
    '2x-small': 'XXS',
    'x-small': 'XS',
    small: 'S',
    medium: 'M',
    large: 'L',
    'x-large': 'XL',
    '2x-large': 'XXL',
    '3x-large': 'XXXL',
    '4x-large': 'XXXXL',
  };
  return labels[normalized] ?? clusterSize;
}
