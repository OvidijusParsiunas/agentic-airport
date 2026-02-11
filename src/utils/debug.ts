import { GameConfig } from '../types/game';

// Debug logging helper
export function debugLog(config: GameConfig, category: string, message: string, data?: object) {
  if (!config.debugLogging) return;
  const timestamp = new Date().toISOString().slice(11, 23);
  const prefix = `[${timestamp}] [${category}]`;
  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}
