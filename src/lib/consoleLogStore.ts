/**
 * Global console log store
 * Shared between download modal and settings console viewer
 */

export type LogLevel = 'LOG' | 'WARN' | 'ERROR';

export interface ConsoleLog {
  level: LogLevel;
  message: string;
  timestamp: number;
}

class ConsoleLogStore {
  private logs: ConsoleLog[] = [];
  private maxLogs = 1000;
  private listeners: Set<(logs: ConsoleLog[]) => void> = new Set();

  addLog(level: LogLevel, ...args: any[]): void {
    const message = args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    const log: ConsoleLog = {
      level,
      message,
      timestamp: Date.now()
    };

    this.logs = [...this.logs, log];

    // Limit log count
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Notify listeners
    this.listeners.forEach(listener => listener(this.logs));
  }

  getLogs(): ConsoleLog[] {
    return this.logs;
  }

  clearLogs(): void {
    this.logs = [];
    this.listeners.forEach(listener => listener(this.logs));
  }

  subscribe(listener: (logs: ConsoleLog[]) => void): () => void {
    this.listeners.add(listener);
    // Immediately call with current logs
    listener(this.logs);
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  setMaxLogs(max: number): void {
    this.maxLogs = max;
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
      this.listeners.forEach(listener => listener(this.logs));
    }
  }
}

export const consoleLogStore = new ConsoleLogStore();

