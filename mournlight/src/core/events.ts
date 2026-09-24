/** Minimal typed event bus used to decouple gameplay, audio, fx and UI. */
export interface GameEvents {
  'player:hurt': { amount: number };
  'player:died': Record<string, never>;
  'player:parry': { x: number; y: number; z: number };
  'player:heal': Record<string, never>;
  'enemy:killed': { type: string; marrow: number; x: number; y: number; z: number };
  'shrine:lit': { id: string; name: string };
  'shrine:rest': { id: string };
  'region:enter': { id: string; name: string };
  'item:pickup': { name: string; desc: string };
  'marrow:recovered': { amount: number };
  'boss:start': { name: string };
  'boss:phase': { name: string };
  'boss:defeated': { name: string };
  'door:opened': { id: string };
  'message': { text: string; duration?: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<unknown>);
    return () => set!.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}

export const events = new EventBus();
