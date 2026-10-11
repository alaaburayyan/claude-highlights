export type Level = 'green' | 'orange' | 'red' | 'blue'
export type Bullet = { level: Level; text: string }
export type Reply = { turnId: string; prompt: string; bullets: Bullet[]; isFailed: boolean; isInterrupted: boolean }
// A usage window's reading: `five_hour` is the session's, `seven_day` the week's.
export type Limit = { kind: string; percentUsed: number }
// The points' own window: the first row shown, and whether it keeps to the newest rows.
export type Scroll = { offset: number; isFollowing: boolean }

declare module 'claude-code' {
  interface PluginState {
    highlights: {
      replies: Reply[]
      currentTurnId: string
      tokens: number
      isOpen: boolean
      limits: Limit[]
      scroll: Scroll
    }
  }
}
