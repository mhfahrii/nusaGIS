import React from 'react';
import { IconCheck, IconAlertCircle, IconClose } from '@/components/icons';

interface AlertNotificationProps {
  type: 'success' | 'error' | 'info';
  message: string;
  onClose?: () => void;
}

export function AlertNotification({ type, message, onClose }: AlertNotificationProps) {
  if (!message) return null;

  const bgStyles = {
    success: 'bg-emerald-50 border-emerald-300 text-emerald-800',
    error: 'bg-rose-50 border-rose-300 text-rose-800',
    info: 'bg-slate-50 border-slate-300 text-slate-800',
  }[type];

  return (
    <div className={`flex items-center justify-between p-3.5 rounded-lg border text-sm font-medium ${bgStyles} transition-all duration-200 shadow-xs mb-4`}>
      <div className="flex items-center gap-2.5">
        {type === 'success' && <IconCheck className="w-5 h-5 text-emerald-600 shrink-0" />}
        {type === 'error' && <IconAlertCircle className="w-5 h-5 text-rose-600 shrink-0" />}
        {type === 'info' && <IconAlertCircle className="w-5 h-5 text-slate-600 shrink-0" />}
        <span>{message}</span>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          type="button"
          className="p-1 hover:bg-black/5 rounded-md transition-colors"
          title="Tutup"
        >
          <IconClose className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

