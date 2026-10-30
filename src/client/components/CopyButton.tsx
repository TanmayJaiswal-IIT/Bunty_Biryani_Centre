import { useState } from 'react';

export interface CopyButtonProps {
  text: string;
  label: string;
  copiedLabel: string;
  ariaLabel: string;
}

export function CopyButton({ text, label, copiedLabel, ariaLabel }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback
        const el = document.getElementById('order-id-display');
        if (el && window.getSelection) {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore copy error
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleCopy();
      }}
      className="rounded-control border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 shadow-xs hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand"
      aria-label={copied ? copiedLabel : ariaLabel}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
