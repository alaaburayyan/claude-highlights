import { expect, mock, test } from 'claude-code/testing'

const REPLY = [
  'I updated the config loader and all 12 tests pass.\n\n',
  'I assumed you want UTF-8 everywhere; tell me if not.\n\n',
  'The deploy failed: your token sk-abcdefghijklmnop1234 expired, so run the login yourself.',
]

test('streams a reply into color-coded, redacted highlights and grays the old reply', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []

  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('model.complete', async (_$, e) => {
    prompts.push(e.prompt)
    return { value: {
      isAnswered: true,
      text: 'GREEN: Config loader updated and tests pass.\nORANGE: Assumed `UTF-8` everywhere.\nRED: Deploy failed; token sk-abcdefghijklmnop1234 expired, run login yourself.',
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } } as never
  })
  on('turn.step', async function* (_$, e) {
    for (const text of REPLY) {
      yield { kind: 'text', index: 0, text }
    }
    return { turnId: e.turnId, index: e.index, answer: REPLY.join(''), toolUses: [], stopReason: 'end_turn', usage: null } as never
  })

  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'fix the config', turnId: 't1' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1 })) {
    // drain the stream as the terminal would
  }
  await clock.advance(1600)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('all 12 tests pass')

  const ui = await $.ui.mount({
    plugin: 'highlights',
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'Highlights' } as never,
    requestId: 'highlights',
  })
  expect(await ui.find({ type: 'Text', text: 'Config loader updated' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'sk-abcdefghijklmnop1234' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'UTF-8' })).toBeUndefined()

  const current = await ui.find({ type: 'Box', key: 't1' })
  expect(current?.props.backgroundColor).toBeUndefined()

  await $.turn.start({ text: 'next question', turnId: 't2' })
  const old = await ui.find({ type: 'Box', key: 't1' })
  expect(old?.props.backgroundColor).toBe('subtle')
})

test('an interrupt clears the reply, bullets already shown and pieces still waiting', async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0

  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('model.complete', async () => {
    calls += 1
    return { value: { isAnswered: true, text: 'GREEN: First paragraph is done.', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: e.messageCount === 1 ? 'The first paragraph says the build is done.\n\n' : 'A second paragraph about the next step.\n\n' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })

  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'build it', turnId: 't1' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1 })) {
  }
  await clock.advance(1600)

  const ui = await $.ui.mount({ plugin: 'highlights', surface: 'terminal', component: 'Pane', props: { title: 'Highlights' } as never, requestId: 'highlights' })
  expect(await ui.find({ type: 'Text', text: 'First paragraph is done' })).toBeDefined()

  // A second piece is queued, then the person interrupts before the next tick.
  for await (const _ of $.turn.step({ turnId: 't1', index: 1, model: 'opus', messageCount: 2 })) {
  }
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: 't1', reason: 'aborted' })
  await clock.advance(1600)

  expect(calls).toBe(1)
  expect(await ui.find({ type: 'Text', text: 'First paragraph is done' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Interrupted, highlights cleared.' })).toBeDefined()
})

const FIVE = ['GREEN: One is done.', 'GREEN: Two is done.', 'ORANGE: Three needs a look.', 'RED: Four failed.', 'GREEN: Five is done.', 'GREEN: Six is done.', 'GREEN: Seven is done.']

function stage(on: any, prompts: string[]) {
  on('session.start', async (_$: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('command.register', async (_$: unknown, e: any) => ({ value: { command: e.name } }) as never)
  on('turn.start', async (_$: unknown, e: any) => ({ turnId: e.turnId }))
  on('model.complete', async (_$: unknown, e: any) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: FIVE.join('\n'), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('turn.step', async function* (_$: unknown, e: any) {
    yield { kind: 'text', index: 0, text: `Paragraph ${e.messageCount} of the reply, with enough words to summarize.\n\n` }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
}

async function ask($: any, clock: any, turnId: string, steps = 1) {
  await $.turn.start({ text: `question ${turnId}`, turnId })
  for (let i = 0; i < steps; i++) {
    for await (const _ of $.turn.step({ turnId, index: i, model: 'opus', messageCount: i + 1 })) {
    }
    await clock.advance(1600)
  }
}

function mountPane($: any) {
  return $.ui.mount({ plugin: 'highlights', surface: 'terminal', component: 'Pane', props: { title: 'Highlights' } as never, requestId: 'highlights' })
}

test('keeps at most 5 highlights per question by default, then stops calling the model', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  stage(on, prompts)

  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await ask($, clock, 't1', 2)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('List at most 5 GREEN, ORANGE or RED points')
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: 'Five is done' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Six is done' })).toBeUndefined()
})

test('a limit of 2 holds each question to 2 highlights', { options: { maxHighlights: 2 } }, async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  stage(on, prompts)

  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await ask($, clock, 't1')
  await ask($, clock, 't2')

  expect(prompts[0]).toContain('List at most 2 GREEN, ORANGE or RED points')
  const ui = await mountPane($)
  expect(await ui.findAll({ type: 'Text', text: 'One is done' })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: 'Three needs a look' })).toBeUndefined()
})

test('a limit of 0 is unlimited', { options: { maxHighlights: 0 } }, async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  stage(on, prompts)

  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await ask($, clock, 't1')

  expect(prompts[0]).not.toContain('List at most')
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: 'Seven is done' })).toBeDefined()
})

test('older questions are drawn above newer ones', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  stage(on, prompts)

  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ask($, clock, 't1')
  await ask($, clock, 't2')
  await ask($, clock, 't3')

  const keys = (await ui.findAll({ type: 'Box' })).map(box => box.key).filter(Boolean)
  expect(keys).toEqual(['t1', 't2', 't3'])
})

test('a task moving to in progress adds a blue step after the text before it', { options: { maxHighlights: 1 } }, async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  stage(on, prompts)
  on('tool.call', async (_$, e: any) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: '7', subject: e.subject } } } as never
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } } as never
    if (e.tool === 'TodoWrite') return { result: { oldTodos: [{ content: 'Write the docs', status: 'in_progress', activeForm: '' }], newTodos: e.todos } } as never
    return { result: {} } as never
  })

  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await ask($, clock, 't1')
  await $.tool.call({ tool: 'TaskCreate', subject: 'Run the test suite', description: 'all of it' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' } as never)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Write the docs', status: 'in_progress', activeForm: '' },
      { content: 'Ship the release', status: 'in_progress', activeForm: '' },
    ],
  } as never)
  await clock.advance(1600)
  await clock.advance(1600)
  await clock.advance(1600)

  const ui = await mountPane($)
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const first = shown.findIndex(t => t.includes('One is done'))
  const step = shown.findIndex(t => t.includes('Run the test suite'))
  // Over the limit of 1 point, the blue steps still show, once each, after the point before them.
  expect(first).toBeGreaterThan(-1)
  expect(step).toBeGreaterThan(first)
  expect(shown.filter(t => t.includes('Run the test suite'))).toHaveLength(1)
  expect(shown.some(t => t.includes('Ship the release'))).toBe(true)
  expect(shown.some(t => t.includes('Write the docs'))).toBe(false)
  expect(shown.some(t => t.includes('Two is done'))).toBe(false)
})

test('a step Claude announces in its text comes back blue from the summary', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('model.complete', async () => ({ value: { isAnswered: true, text: 'BLUE: Migrating the database\nGREEN: Backup taken.', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: 'I took a backup. Next I will migrate the database schema.\n\n' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })

  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await ask($, clock, 't1')

  const ui = await mountPane($)
  const step = await ui.find({ type: 'Text', text: 'Migrating the database' })
  expect(step).toBeDefined()
  expect(JSON.stringify(step?.children)).toContain('suggestion')
})

test('the legend and token count head the pane: one line when wide, two when narrow', async ($, on) => {
  const clock = mock.clock(on)
  stage(on, [])
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await ask($, clock, 't1')

  const mount = (bodyColumns: number) =>
    $.ui.mount({ plugin: 'highlights', surface: 'terminal', component: 'Pane', props: { title: 'Highlights', bodyColumns } as never, requestId: 'highlights' })

  const wide = await mount(120)
  expect((await wide.find({ type: 'Text', text: 'Highlights Tokens: 2' }))?.text).toContain('🔵 step')
  await wide.unmount()

  const narrow = await mount(30)
  const legend = await narrow.find({ type: 'Text', text: '🔵 step' })
  const usage = await narrow.find({ type: 'Text', text: 'Highlights Tokens: 2' })
  expect(legend?.text).toBe('🔵 step  🟢 done  🟠 notice  🔴 act')
  expect(usage?.text).toBe('Highlights Tokens: 2')
  expect(await narrow.find({ type: 'Text', text: 'One is done' })).toBeDefined()
})

const dock = (bodyRows: number) => ({ title: 'Highlights', bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows } })

function wheel($: any, by: number) {
  return $.ui.scroll({ component: 'Pane', requestId: 'highlights', offset: 0, by, bodyRows: 10, contentRows: 10, origin: { kind: 'person' } })
}

test('the footer shows the session and weekly usage, updated as the engine measures it', async ($, on) => {
  stage(on, [])
  on('session.measure', async (_$: unknown, e: any) => ({ changed: e.changed }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 23.4 }] } }) as never)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'highlights', surface: 'terminal', component: 'Pane', props: dock(10) as never, requestId: 'highlights' })
  const footer = async () => (await lines(ui)).at(-1)
  expect(await footer()).toBe('Session 23% · Weekly –')

  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 91 }, { kind: 'seven_day', percentUsed: 40.6 }],
    changed: ['rateLimits'],
  } as never)
  expect(await footer()).toBe('Session 91% · Weekly 41%')
  const colorOf = async (text: string) => (await ui.findAll({ type: 'Text', text })).find((t: any) => t.text === text)?.props.color
  expect(await colorOf('91%')).toBe('error')
  expect(await colorOf('41%')).toBe('success')
})

test('header and footer stay put while the points scroll between them, following the newest', async ($, on) => {
  const clock = mock.clock(on)
  stage(on, [])
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  for (const turnId of ['t1', 't2', 't3', 't4']) {
    await ask($, clock, turnId)
  }
  // Each question takes a prompt row and five points, with a gap between: far more than 8 rows.
  const ui = await $.ui.mount({ plugin: 'highlights', surface: 'terminal', component: 'Pane', props: dock(8) as never, requestId: 'highlights' })
  const texts = () => lines(ui)

  let shown = await texts()
  expect(shown[0]).toContain('Highlights Tokens')
  expect(shown[shown.length - 1]).toContain('Session')
  expect(shown.length).toBe(8)
  expect(shown).toContain('● Five is done.')
  expect(shown.join('\n')).not.toContain('question t1')

  // Scrolling up leaves the newest behind, keeps header and footer, and holds still as new points arrive.
  await wheel($, -100)
  shown = await texts()
  expect(shown[0]).toContain('Highlights Tokens')
  expect(shown[1]).toBe('› question t1')
  expect(shown[shown.length - 1]).toContain('Session')
  await ask($, clock, 't5')
  expect((await texts())[1]).toBe('› question t1')

  // Back to the bottom follows the newest again.
  await wheel($, 1000)
  await ask($, clock, 't6')
  expect((await texts()).join('\n')).toContain('› question t6')
})

// The pane as its rows read on screen: each top-level Text one line, a spacer Box its height in blank lines.
async function lines(ui: any): Promise<string[]> {
  const out: string[] = []
  const textOf = (node: any): string =>
    typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join('')
  const walk = (node: any) => {
    if (!node || typeof node === 'string') return
    if (node.type === 'Text') {
      out.push(textOf(node))
      return
    }
    if (node.type === 'Box' && typeof node.props?.height === 'number' && !(node.children ?? []).length) {
      for (let i = 0; i < node.props.height; i++) out.push('')
      return
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(await ui.drawn())
  return out
}
