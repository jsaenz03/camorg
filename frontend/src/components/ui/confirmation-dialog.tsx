import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => Promise<void> | void;
  isConfirming?: boolean;
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  onConfirm,
  isConfirming = false,
}: ConfirmationDialogProps) {
  const [isInternalConfirming, setIsInternalConfirming] = useState(false);

  const handleConfirm = async () => {
    try {
      setIsInternalConfirming(true);
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      console.error('Confirmation action failed:', error);
      // Keep dialog open on error
    } finally {
      setIsInternalConfirming(false);
    }
  };

  const isCurrentlyConfirming = isConfirming || isInternalConfirming;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {variant === 'destructive' && (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCurrentlyConfirming}
          >
            {cancelText}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={isCurrentlyConfirming}
            className="flex items-center gap-2"
          >
            {isCurrentlyConfirming && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}