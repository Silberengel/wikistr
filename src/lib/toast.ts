// Simple toast notification system
import { writable } from 'svelte/store';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  duration?: number; // Auto-dismiss after this many ms (0 = no auto-dismiss)
}

export const toasts = writable<Toast[]>([]);
let nextId = 1;

export function showToast(toast: Omit<Toast, 'id'>): string {
  const id = `toast-${nextId++}`;
  const newToast: Toast = {
    id,
    duration: 5000, // Default 5 seconds
    ...toast
  };
  
  toasts.update(current => [...current, newToast]);
  
  // Auto-dismiss if duration is set
  if (newToast.duration && newToast.duration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, newToast.duration);
  }
  
  return id;
}

export function dismissToast(id: string): void {
  toasts.update(current => current.filter(toast => toast.id !== id));
}

export function clearAllToasts(): void {
  toasts.set([]);
}
