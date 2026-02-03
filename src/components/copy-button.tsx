'use client';

import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CopyButtonProps extends ButtonProps {
  value: string;
}

export function CopyButton({ value, ...props }: CopyButtonProps) {
  const { toast } = useToast();
  const [hasCopied, setHasCopied] = React.useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(value).then(() => {
      setHasCopied(true);
      toast({ title: 'Copied!', description: 'Content copied to clipboard.' });
      setTimeout(() => setHasCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
      toast({ variant: 'destructive', title: 'Failed to copy', description: 'Could not copy content to clipboard.' });
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={copyToClipboard}
      {...props}
    >
      {hasCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="sr-only">Copy</span>
    </Button>
  );
}
