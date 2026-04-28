import { useMemo, useState } from 'react';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  cn,
} from '@databricks/appkit-ui/react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import type { CatalogSummary } from '@lakecost/shared';

export type CatalogSelection = { name: string; create: boolean };

export interface CatalogComboboxProps {
  value: string;
  onChange: (selection: CatalogSelection) => void;
  options: CatalogSummary[];
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  createLabel?: (name: string) => string;
  validateName: (name: string) => boolean;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Combobox over Unity Catalog catalogs that also offers "Create '<name>'" when the query doesn't match. */
export function CatalogCombobox({
  value,
  onChange,
  options,
  loading = false,
  disabled = false,
  placeholder = 'Select a catalog…',
  searchPlaceholder = 'Search catalogs…',
  emptyText = 'No catalogs found.',
  createLabel = (name) => `Create "${name}"`,
  validateName,
}: CatalogComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const trimmed = query.trim();
  const exactMatch = useMemo(
    () => options.some((o) => o.name === trimmed),
    [options, trimmed],
  );
  const showCreate =
    trimmed.length > 0 && !exactMatch && IDENT_RE.test(trimmed) && validateName(trimmed);

  const handleSelect = (name: string, create: boolean) => {
    onChange({ name, create });
    setOpen(false);
    setQuery('');
  };

  const triggerLabel = value ? value : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="max-w-md justify-between font-normal"
          type="button"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{triggerLabel}</span>
          {loading ? (
            <Spinner className="ml-2 size-4 shrink-0 opacity-60" />
          ) : (
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-60" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {options.length > 0 ? (
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.name}
                    value={opt.name}
                    onSelect={() => handleSelect(opt.name, false)}
                  >
                    <Check
                      className={cn(
                        'mr-2 size-4',
                        value === opt.name ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="truncate">{opt.name}</span>
                    {opt.catalogType ? (
                      <span className="text-muted-foreground ml-auto text-xs">
                        {opt.catalogType.replace(/_CATALOG$/, '').toLowerCase()}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {showCreate ? (
              <CommandGroup heading="">
                <CommandItem
                  key={`__create__${trimmed}`}
                  value={`__create__${trimmed}`}
                  onSelect={() => handleSelect(trimmed, true)}
                >
                  <Plus className="mr-2 size-4" />
                  {createLabel(trimmed)}
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
