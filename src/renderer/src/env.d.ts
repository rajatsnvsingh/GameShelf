/** Declares the preload API that renderer TypeScript receives from Electron. */
import type { GameShelfApi } from '../../shared/api';

declare global {
  interface Window {
    gameShelf: GameShelfApi;
  }
}
