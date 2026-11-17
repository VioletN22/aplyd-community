export interface CalendarStatus {
  configured: boolean;
  connected: boolean;
  connecting: boolean;
  syncing: boolean;
  lastSync: string | null;
  error: string | null;
}
