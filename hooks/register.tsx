import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bullet, Level, Reply } from '../types'

const PANE = 'highlights'
const TITLE = 'Highlights'
const MODEL = 'haiku'
const KEEP_REPLIES = 15
const TICK_MS = 1500
const DEFAULT_LIMIT = 5

const replies = atom({ plugin: 'highlights', key: 'replies' } as const, [])
const currentTurnId = atom({ plugin: 'highlights', key: 'currentTurnId' } as const, '')
const tokens = atom({ plugin: 'highlights', key: 'tokens' } as const, 0)
const isOpen = atom({ plugin: 'highlights', key: 'isOpen' } as const, false)

const COLOR: Record<Level, string> = { green: 'success', orange: 'warning', red: 'error', blue: 'suggestion' }
const OLD_BACKGROUND = 'subtle'
const LEGEND = '🔵 step  🟢 done  🟠 notice  🔴 act'
// Each emoji is two cells wide and two UTF-16 units long, so the length is the width.
const LEGEND_COLUMNS = LEGEND.length

const RULES = `You extract the points worth noting from an AI coding assistant's reply, for a reader who will not read the full reply.

Write one line per point, in this exact form:
GREEN: <point>   - something done, confirmed or working
ORANGE: <point>  - something the reader should notice: an assumption, a choice to make, a caveat, a question for them
RED: <point>     - an error, a failure, a risk, or something the reader must do themselves
BLUE: <title>    - a new step of the work the assistant says it is starting, as a short title ("Running the test suite")

Rules:
- List every point worth noting, as many as there are; skip filler and restated context.
- BLUE is for a real new step or phase of the work, not every small action ("let me read this file" is not a step).
- Each point is one short plain sentence. No markdown, no backticks.
- Never include code, commands, file contents, secrets, keys, tokens, passwords, emails or personal data. Describe them instead ("an API key was found in the config").
- Do not repeat a point already given (listed below as "Already given").
- If nothing in the new text is worth noting, reply with exactly: NONE`

// The reply's text as it streams, waiting to be summarized. Module-local: a reload drops what is in flight.
const buffers = new Map<string, string>()
// Text pieces to summarize, and step titles from the task list, kept in the order they happened.
const queue: ({ turnId: string; text: string } | { turnId: string; step: string })[] = []
// Task ids to their subjects, so a TaskUpdate naming only an id can be titled.
const taskSubjects = new Map<string, string>()
const interrupted = new Set<string>()
let isBusy = false
// Most highlights per reply, from the `maxHighlights` option; 0 is no limit.
let limit = DEFAULT_LIMIT
// True while the person's window is on the pane's last rows; scrolling up turns it off, back down on.
let isFollowing = true

function readLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_LIMIT
}

function feed(turnId: string, text: string) {
  const buffer = (buffers.get(turnId) ?? '') + text
  const cut = buffer.lastIndexOf('\n\n')
  if (cut < 0) {
    buffers.set(turnId, buffer)
    return
  }
  queue.push({ turnId, text: buffer.slice(0, cut) })
  buffers.set(turnId, buffer.slice(cut + 2))
}

function flush(turnId: string) {
  const rest = buffers.get(turnId) ?? ''
  buffers.delete(turnId)
  if (rest.trim()) {
    queue.push({ turnId, text: rest })
  }
}

// A step starts: the text streamed so far is queued ahead of it, so the step lands after it in the pane.
function startStep(turnId: string, title: string) {
  const clean = redact(title)
  if (!turnId || !clean || clean === '[hidden]') {
    return
  }
  flush(turnId)
  queue.push({ turnId, step: clean })
}

// The limit holds the green, orange and red points; blue steps are always kept.
function capped(bullets: Bullet[]): Bullet[] {
  if (limit === 0) {
    return bullets
  }
  let points = 0
  return bullets.filter(bullet => bullet.level === 'blue' || ++points <= limit)
}

const isPoint = (bullet: Bullet) => bullet.level !== 'blue'

function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' [code omitted] ')
    .replace(/^( {4}|\t).*$/gm, '')
}

const SECRET_PATTERNS: RegExp[] = [
  /`[^`]*`/g,
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,
  /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{12,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@\S+/gi,
  /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*\S+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /-----BEGIN [A-Z ]+-----[\s\S]*?(-----END [A-Z ]+-----|$)/g,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}/g,
]

function redact(text: string): string {
  return SECRET_PATTERNS.reduce((out, pattern) => out.replace(pattern, '[hidden]'), text)
    .replace(/\s+/g, ' ')
    .trim()
}

function parse(text: string): Bullet[] {
  const bullets: Bullet[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*[-*]?\s*(GREEN|ORANGE|RED|BLUE)\s*[:|-]\s*(.+)$/i.exec(line)
    if (!match) {
      continue
    }
    const clean = redact(match[2])
    if (clean && clean !== '[hidden]') {
      bullets.push({ level: match[1].toLowerCase() as Level, text: clean })
    }
  }
  return bullets
}

function patchReply($: EngineInterface, turnId: string, change: (reply: Reply) => Reply) {
  return update($, replies, list => list.map(reply => (reply.turnId === turnId ? change(reply) : reply)))
}

async function summarize($: EngineInterface, turnId: string, text: string) {
  const fresh = stripCode(text).trim()
  if (fresh.length < 15) {
    return
  }
  const given = (await read($, replies)).find(reply => reply.turnId === turnId)?.bullets ?? []
  // A reply at its limit needs no more model calls.
  const room = limit === 0 ? Infinity : limit - given.filter(isPoint).length
  if (room <= 0) {
    return
  }
  const already = given.length ? given.map(b => `${b.level.toUpperCase()}: ${b.text}`).join('\n') : '(none)'
  const cap =
    room === Infinity ? '' : `List at most ${room} GREEN, ORANGE or RED point${room === 1 ? '' : 's'}, the most important first.\n\n`

  const result = await $.model.complete({
    model: MODEL,
    system: [{ text: RULES, cache: true }],
    prompt: `${cap}Already given:\n${already}\n\nNew text of the reply:\n<<<\n${fresh}\n>>>`,
    maxTokens: 800,
  })

  const usage = result.usage
  if (usage) {
    const spent = usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
    await update($, tokens, total => total + spent)
  }

  // An interrupt that landed while this call was out wins: what it brought back is dropped.
  if (interrupted.has(turnId)) {
    return
  }
  if (!result.isAnswered) {
    await patchReply($, turnId, reply => ({ ...reply, isFailed: true }))
    return
  }
  const bullets = parse(result.text)
  if (bullets.length) {
    await patchReply($, turnId, reply => ({ ...reply, bullets: capped([...reply.bullets, ...bullets]) }))
    await scrollToEnd($)
  }
}

async function addStep($: EngineInterface, turnId: string, title: string) {
  if (interrupted.has(turnId)) {
    return
  }
  await patchReply($, turnId, reply => {
    const isRepeat = reply.bullets.some(b => b.level === 'blue' && b.text.toLowerCase() === title.toLowerCase())
    return isRepeat ? reply : { ...reply, bullets: [...reply.bullets, { level: 'blue', text: title }] }
  })
  await scrollToEnd($)
}

// Newest at the bottom, as in the transcript: keep the pane's window on the end, unless the person scrolled up.
async function scrollToEnd($: EngineInterface) {
  if (isFollowing && (await read($, isOpen))) {
    await $.ui.scroll({ in: PANE, to: 'end' }).catch(() => undefined)
  }
}

async function drain($: EngineInterface) {
  if (isBusy || queue.length === 0) {
    return
  }
  isBusy = true
  try {
    const head = queue[0]!
    if ('step' in head) {
      queue.shift()
      await addStep($, head.turnId, head.step)
      return
    }
    // The oldest turn's text up to its next step goes in one call, so a fast stream batches itself.
    const turnId = head.turnId
    const pieces: string[] = []
    while (queue.length && queue[0]!.turnId === turnId && 'text' in queue[0]!) {
      pieces.push((queue.shift() as { text: string }).text)
    }
    await summarize($, turnId, pieces.join('\n\n'))
  } catch {
    // A failed summary costs that piece alone; the next tick goes on.
  } finally {
    isBusy = false
  }
}

async function openPane($: EngineInterface) {
  await update($, isOpen, () => true)
  await $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = (on, options) => {
  limit = readLimit(options.maxHighlights)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'highlights',
      description: 'Show or hide the live highlights pane',
    })
    $.clock.every(TICK_MS, () => {
      void drain($)
    })
    void openPane($)

    return next(e)
  })

  on('command.run', { command: 'highlights' }, async $ => {
    if (await read($, isOpen)) {
      await $.ui.close({ id: PANE })
      await update($, isOpen, () => false)
      return { text: 'Highlights pane closed.' }
    }
    await openPane($)
    return { text: 'Highlights pane opened.' }
  })

  // A task in Claude's task list moving to in progress is a new step: a blue highlight with its title.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = ran.result?.task.id
    if (id && !e.agentId) {
      taskSubjects.set(id, e.subject)
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.status === 'in_progress' && !e.agentId && ran.result?.success) {
      const title = e.subject ?? taskSubjects.get(e.taskId)
      if (title) {
        startStep(await read($, currentTurnId), title)
      }
    }
    if (e.subject) {
      taskSubjects.set(e.taskId, e.subject)
    }
    return ran
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId && ran.result) {
      const wasActive = new Set(ran.result.oldTodos.filter(t => t.status === 'in_progress').map(t => t.content))
      const turnId = await read($, currentTurnId)
      for (const todo of e.todos) {
        if (todo.status === 'in_progress' && !wasActive.has(todo.content)) {
          startStep(turnId, todo.content)
        }
      }
    }
    return ran
  })

  // Where the person's own scroll lands decides whether new highlights pull the window down.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') {
      isFollowing = e.offset >= e.contentRows - e.bodyRows
    }
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) {
      await update($, isOpen, () => false).catch(() => undefined)
    }
    return closed
  })

  // A new prompt: every earlier reply turns gray, and this one starts empty.
  on('turn.start', async ($, e, next) => {
    const preview = redact(stripCode(e.text)).slice(0, 70) || '(continued)'
    const reply: Reply = { turnId: e.turnId, prompt: preview, bullets: [], isFailed: false, isInterrupted: false }
    await update($, replies, list => [...list, reply].slice(-KEEP_REPLIES))
    await update($, currentTurnId, () => e.turnId)
    await scrollToEnd($)

    return next(e)
  })

  // Read the main reply's text as it streams, paragraph by paragraph; subagents are left out.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      return yield* next(e)
    }
    try {
      for await (const chunk of next(e)) {
        if (chunk.kind === 'text') {
          feed(e.turnId, chunk.text)
        }
        yield chunk
      }
    } finally {
      flush(e.turnId)
    }
  })

  // An interrupt clears the reply's bullets, and drops what of it still waits to be summarized.
  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'aborted' && !e.agentId) {
      interrupted.add(e.turnId)
      buffers.delete(e.turnId)
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i]!.turnId === e.turnId) {
          queue.splice(i, 1)
        }
      }
      await patchReply($, e.turnId, reply => ({ ...reply, bullets: [], isFailed: false, isInterrupted: true })).catch(
        () => undefined,
      )
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, replies)
    const current = await read($, currentTurnId)
    const spent = await read($, tokens)
    const usage = `Highlights Tokens: ${spent.toLocaleString()}`
    // The legend and the token count share one line where the pane is wide enough, else take two.
    const isOneLine = e.props.bodyColumns >= LEGEND_COLUMNS + 3 + usage.length

    return (
      <Box flexDirection="column" overflow="hidden">
        {isOneLine ? (
          <Text dimColor>
            {LEGEND} · {usage}
          </Text>
        ) : (
          <Box flexDirection="column">
            <Text dimColor>{LEGEND}</Text>
            <Text dimColor>{usage}</Text>
          </Box>
        )}
        {list.length === 0 && <Text dimColor>Highlights of Claude's replies appear here as they stream.</Text>}
        {list.map((reply, index) => {
          const isOld = reply.turnId !== current
          const background = isOld ? OLD_BACKGROUND : undefined
          return (
            <Box
              key={reply.turnId}
              flexDirection="column"
              backgroundColor={background}
              paddingX={1}
              marginTop={index === 0 ? 0 : 1}
            >
              <Text bold backgroundColor={background}>
                › {reply.prompt}
              </Text>
              {reply.bullets.map(bullet => (
                <Text backgroundColor={background}>
                  <Text color={COLOR[bullet.level]}>● </Text>
                  {bullet.text}
                </Text>
              ))}
              {reply.isInterrupted && (
                <Text dimColor backgroundColor={background}>
                  Interrupted, highlights cleared.
                </Text>
              )}
              {reply.bullets.length === 0 && !reply.isFailed && !reply.isInterrupted && (
                <Text dimColor backgroundColor={background}>
                  {isOld ? 'Nothing worth noting.' : 'Listening…'}
                </Text>
              )}
              {reply.isFailed && (
                <Text dimColor backgroundColor={background}>
                  Some highlights unavailable (model call failed).
                </Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
