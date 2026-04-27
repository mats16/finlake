import { useState } from 'react';
import { Button } from '@databricks/appkit-ui/react';
import { Check, Copy } from 'lucide-react';

export function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <pre className="bg-(--code-bg) border-border text-foreground relative overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onCopy}
        className="absolute top-2 right-2 h-7 px-2 text-[11px]"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <code>{children}</code>
    </pre>
  );
}
