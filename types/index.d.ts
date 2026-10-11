export type Level = 'green' | 'orange' | 'red' | 'blue'
export type Bullet = { level: Level; text: string }
export type Reply = { turnId: string; prompt: string; bullets: Bullet[]; isFailed: boolean; isInterrupted: boolean }

declare module 'claude-code' {
  interface PluginState {
    highlights: { replies: Reply[]; currentTurnId: string; tokens: number; isOpen: boolean }
  }
}
