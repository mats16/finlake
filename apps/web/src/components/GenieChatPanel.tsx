import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  GenieChatInput,
  GenieChatMessageList,
  Spinner,
  useGenieChat,
} from '@databricks/appkit-ui/react';
import { AlertCircle, ExternalLink, MessageCirclePlus, Sparkles, X } from 'lucide-react';

export function GenieChatPanel({
  alias,
  placeholder,
  initialPrompt,
  initialPromptKey,
  resetSignal,
  disabled,
  className,
}: {
  alias: string;
  placeholder?: string;
  initialPrompt?: string | null;
  initialPromptKey?: string | null;
  resetSignal?: number;
  disabled?: boolean;
  className?: string;
}) {
  const sentInitialPromptRef = useRef<string | null>(null);
  const lastResetSignalRef = useRef(resetSignal ?? 0);
  const { messages, status, error, sendMessage, reset, hasPreviousPage, fetchPreviousPage } =
    useGenieChat({
      alias,
      basePath: '/api/genie',
      persistInUrl: false,
    });

  useEffect(() => {
    const prompt = initialPrompt?.trim();
    const key = initialPromptKey ?? prompt ?? null;
    if (!prompt || !key || disabled || sentInitialPromptRef.current === key) return;
    sentInitialPromptRef.current = key;
    sendMessage(prompt);
  }, [disabled, initialPrompt, initialPromptKey, sendMessage]);

  useEffect(() => {
    const signal = resetSignal ?? 0;
    if (signal === lastResetSignalRef.current) return;
    lastResetSignalRef.current = signal;
    reset();
  }, [reset, resetSignal]);

  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${className ?? ''}`}>
      <GenieChatMessageList
        messages={messages}
        status={status}
        hasPreviousPage={hasPreviousPage}
        onFetchPreviousPage={fetchPreviousPage}
        className="min-h-0 flex-1 !pt-2"
      />
      {error ? (
        <Alert variant="destructive" className="shrink-0 rounded-none border-x-0 border-b-0">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <GenieChatInput
        onSend={sendMessage}
        disabled={disabled || status === 'streaming' || status === 'loading-history'}
        placeholder={placeholder}
        className="shrink-0"
      />
    </div>
  );
}

export function GeniePopupChat({
  open,
  title,
  alias,
  placeholder,
  initialPrompt,
  initialPromptKey,
  loading,
  error,
  fullPageHref,
  onClose,
}: {
  open: boolean;
  title: string;
  alias: string;
  placeholder?: string;
  initialPrompt?: string | null;
  initialPromptKey?: string | null;
  loading?: boolean;
  error?: string | null;
  fullPageHref?: string;
  onClose: () => void;
}) {
  const [resetSignal, setResetSignal] = useState(0);

  if (!open) return null;

  return (
    <Card className="fixed right-3 bottom-3 left-3 z-50 flex h-[min(760px,calc(100vh-24px))] w-auto flex-col overflow-hidden shadow-2xl sm:right-5 sm:bottom-5 sm:left-auto sm:h-[min(760px,calc(100vh-40px))] sm:w-[min(920px,calc(100vw-40px))]">
      <div className="border-border flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate text-sm font-semibold">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="New conversation"
            onClick={() => setResetSignal((value) => value + 1)}
          >
            <MessageCirclePlus className="size-4" />
          </Button>
          {fullPageHref ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Open Genie chat page"
              asChild
            >
              <a href={fullPageHref}>
                <ExternalLink className="size-4" />
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Close Genie chat"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <CardContent className="min-h-0 flex-1 p-0">
        {loading ? (
          <div className="grid h-full place-items-center">
            <Spinner />
          </div>
        ) : error ? (
          <Alert variant="destructive" className="m-4">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <GenieChatPanel
            alias={alias}
            placeholder={placeholder}
            initialPrompt={initialPrompt}
            initialPromptKey={initialPromptKey}
            resetSignal={resetSignal}
          />
        )}
      </CardContent>
    </Card>
  );
}
