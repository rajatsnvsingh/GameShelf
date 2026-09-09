export const APP_INFO_CHANNEL = 'app:get-info';
export const LIBRARY_STATE_CHANNEL = 'library:get-state';
export const CHOOSE_ROOT_CHANNEL = 'library:choose-root';

export interface LibraryState {
  status: 'unconfigured' | 'ready' | 'unavailable' | 'config-error';
  root: string | null;
  message: string;
}

export interface AppInfo {
  name: string;
  version: string;
}

export interface GameShelfApi {
  getAppInfo(): Promise<AppInfo>;
  getLibraryState(): Promise<LibraryState>;
  chooseLibraryRoot(): Promise<LibraryState>;
}
