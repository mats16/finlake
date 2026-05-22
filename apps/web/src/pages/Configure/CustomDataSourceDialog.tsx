import { useEffect, useState, type FormEvent, type WheelEvent } from 'react';
import type { CustomDataSourcePipelineOption } from '@finlake/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@databricks/appkit-ui/react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useCustomDataSourceOptions } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { messageOf } from './utils';

const NO_PIPELINE_VALUE = '__none__';
const NO_TABLE_VALUE = '__no_table__';

function scrollContentOnWheel(event: WheelEvent<HTMLDivElement>) {
  const scrollable = event.currentTarget;
  if (scrollable.scrollHeight <= scrollable.clientHeight) return;

  const previousScrollTop = scrollable.scrollTop;
  scrollable.scrollTop += event.deltaY;
  if (scrollable.scrollTop === previousScrollTop) return;

  event.preventDefault();
  event.stopPropagation();
}

export function CustomDataSourceDialog({
  open,
  createPending,
  createError,
  onClose,
  onSubmit,
  registeredTableNames = [],
}: {
  open: boolean;
  createPending: boolean;
  createError: string | null;
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    pipelineId: string | null;
    tableName: string;
  }) => Promise<void>;
  registeredTableNames?: string[];
}) {
  const { t } = useI18n();
  const options = useCustomDataSourceOptions(open);
  const pipelines = options.data?.pipelines ?? [];
  const registeredTables = new Set(registeredTableNames.map(normalizeTableNameForComparison));
  const tables = (options.data?.tables ?? []).filter(
    (table) => !registeredTables.has(normalizeTableNameForComparison(table.fullName)),
  );
  const [name, setName] = useState('');
  const [pipelineId, setPipelineId] = useState(NO_PIPELINE_VALUE);
  const [tableName, setTableName] = useState('');
  const selectedName = name.trim();
  const selectedPipelineId = pipelineId === NO_PIPELINE_VALUE ? null : pipelineId;
  const selectedTableName = tableName.trim();
  const canSubmit =
    Boolean(selectedName && selectedTableName) && !createPending && !options.isLoading;

  useEffect(() => {
    if (!open) return;
    if (!tableName && tables[0]) setTableName(tables[0].fullName);
  }, [open, tableName, tables]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    await onSubmit({
      name: selectedName,
      pipelineId: selectedPipelineId,
      tableName: selectedTableName,
    });
    setName('');
    setPipelineId(NO_PIPELINE_VALUE);
    setTableName('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t('dataSources.custom.addTitle')}</DialogTitle>
            <DialogDescription>{t('dataSources.custom.addDesc')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <FieldLabel htmlFor="custom-data-source-name">
              {t('dataSources.custom.displayName')}
            </FieldLabel>
            <Input
              id="custom-data-source-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('dataSources.custom.namePlaceholder')}
              disabled={createPending}
            />
          </div>

          <div className="grid gap-2">
            <FieldLabel>{t('dataSources.custom.tableName')}</FieldLabel>
            <Select
              value={tableName || NO_TABLE_VALUE}
              onValueChange={(value) => {
                if (value !== NO_TABLE_VALUE) setTableName(value);
              }}
              disabled={options.isLoading || tables.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('dataSources.custom.tablePlaceholder')} />
              </SelectTrigger>
              <SelectContent className="max-h-72" onWheelCapture={scrollContentOnWheel}>
                <SelectItem value={NO_TABLE_VALUE} disabled>
                  {t('dataSources.custom.tablePlaceholder')}
                </SelectItem>
                {tables.map((table) => (
                  <SelectItem key={table.fullName} value={table.fullName}>
                    {table.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground m-0 text-xs">{t('dataSources.custom.tableHelp')}</p>
            {!options.isLoading && tables.length === 0 ? (
              <p className="text-destructive m-0 text-xs">
                {options.data?.tables.length
                  ? t('dataSources.custom.allTablesRegistered')
                  : t('dataSources.custom.noTables')}
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <FieldLabel>{t('dataSources.custom.pipelineId')}</FieldLabel>
            <PipelineCombobox
              value={pipelineId}
              pipelines={pipelines}
              loading={options.isLoading}
              onChange={setPipelineId}
            />
            <p className="text-muted-foreground m-0 text-xs">
              {t('dataSources.custom.pipelineHelp')}
            </p>
          </div>

          {options.error ? (
            <Alert variant="destructive">
              <AlertDescription>{messageOf(options.error)}</AlertDescription>
            </Alert>
          ) : null}

          {createError ? (
            <Alert variant="destructive">
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={createPending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createPending ? t('common.saving') : t('dataSources.custom.addAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function normalizeTableNameForComparison(tableName: string): string {
  return tableName
    .split('.')
    .map((part) => part.trim().toLowerCase())
    .join('.');
}

function PipelineCombobox({
  value,
  pipelines,
  loading,
  onChange,
}: {
  value: string;
  pipelines: CustomDataSourcePipelineOption[];
  loading: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = pipelines.find((pipeline) => pipeline.id === value);
  const label = selected?.name ?? t('dataSources.custom.noPipeline');

  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={loading}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput placeholder={t('dataSources.custom.pipelineSearchPlaceholder')} />
          <CommandList
            className="max-h-72 overflow-y-auto overscroll-contain"
            onWheelCapture={scrollContentOnWheel}
          >
            <CommandEmpty>{t('dataSources.custom.noPipelines')}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={t('dataSources.custom.noPipeline')}
                onSelect={() => selectValue(NO_PIPELINE_VALUE)}
              >
                <Check
                  className={cn(
                    'mr-2 size-4',
                    value === NO_PIPELINE_VALUE ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <span className="truncate">{t('dataSources.custom.noPipeline')}</span>
              </CommandItem>
              {pipelines.map((pipeline) => (
                <CommandItem
                  key={pipeline.id}
                  value={`${pipeline.name} ${pipeline.id}`}
                  onSelect={() => selectValue(pipeline.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4',
                      value === pipeline.id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="truncate">{pipeline.name}</span>
                  {pipeline.state ? (
                    <span className="text-muted-foreground ml-auto text-xs">{pipeline.state}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
