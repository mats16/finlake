import { useState } from 'react';

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
    <pre className="code-block">
      <button type="button" className="copy" onClick={onCopy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <code>{children}</code>
    </pre>
  );
}
