import z from '@deepseek-ai/schemastery';
import { defineTool, projectToolSchema } from '@deepseek-ai/dsh-tools';
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native';
import { buildIndex } from './search.mjs';

export const name = 'tool-index';
export const inject = ['agents', 'tools'];
export const Config = z.object({
  deferredPrefixes: z.array(z.string()).default(['mcp__']),
  pinnedTools: z.array(z.string()).default([]),
});

export function apply(ctx, config) {
  const native = new NativeToolExecutor(ctx);
  const pending = new WeakMap();
  const indexes = new WeakMap();
  const pinned = new Set(['dsh_search_tools', 'dsh_call_tool', ...config.pinnedTools]);
  const prefixes = config.deferredPrefixes.filter(Boolean);
  const deferred = tool => !pinned.has(tool.name) && prefixes.some(prefix => tool.name.startsWith(prefix));
  let revision = 0;
  let callNumber = 0;

  function indexFor(agent, definitions) {
    if (!agent) return buildIndex(definitions);
    const cached = indexes.get(agent);
    if (cached?.revision === revision && cached.definitions.length === definitions.length &&
        cached.definitions.every((tool, index) => tool === definitions[index])) return cached.index;
    const index = buildIndex(definitions);
    indexes.set(agent, { revision, definitions, index });
    return index;
  }

  ctx.on('tools/change', () => { revision++; });
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source.kind !== 'user') return;
    const query = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    pending.set(agent, { query, selected: undefined });
  });
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') pending.delete(agent);
  });

  ctx.tools.setExecutor({
    describe(definitions) {
      const agent = ctx.agents.currentInitiator();
      const state = agent && pending.get(agent);
      if (state?.query) {
        state.selected = indexFor(agent, definitions).preselect(state.query, deferred);
        state.query = '';
      }
      return native.describe(definitions.filter(tool => !deferred(tool) || tool.name === state?.selected));
    },
    execute: input => native.execute(input),
  });

  ctx.tools.register(defineTool({
    name: 'dsh_search_tools',
    description: 'Find a specialized tool when the visible tools cannot do the job. Describe the intended action and object. If needed, search again by an exact result name to get its arguments. Use dsh_call_tool to invoke the chosen tool.',
    parameters: {
      query: { type: 'string', required: true, description: 'Action and object, or an exact tool name.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute({ query }, exec) {
      if (!exec.agent || !exec.toolSet) throw new Error('Tool search requires an active DSH step.');
      const definitions = ctx.tools.definitions(exec.agent, exec.toolSet);
      const hits = indexFor(exec.agent, definitions).rank(query).filter(hit => deferred(hit.tool)).slice(0, 3);
      return hits.map(({ tool, exact }, index) => {
        const schema = projectToolSchema(tool, false);
        const includeParameters = exact || (index === 0 && JSON.stringify(schema.parameters).length <= 4000);
        return {
          name: schema.name,
          description: schema.description.slice(0, 240),
          ...(includeParameters ? { parameters: schema.parameters } : {}),
        };
      });
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dsh_call_tool',
    description: 'Invoke an available specialized tool by exact name with arguments matching its discovered schema.',
    parameters: {
      name: { type: 'string', required: true, description: 'Exact name returned by dsh_search_tools.' },
      arguments: { type: 'json', description: 'Argument object for the target tool.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => value.content,
      presentationMeta: (_args, value) => value.meta ?? null,
    },
    async execute(args, exec) {
      if (!exec.agent || !exec.toolSet) throw new Error('Tool invocation requires an active DSH step.');
      const tool = ctx.tools.get(args.name, exec.agent, exec.toolSet);
      if (!tool || !deferred(tool)) throw new Error(`Specialized tool unavailable: ${args.name}`);
      const parameters = args.arguments ?? {};
      if (typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('Arguments must be a JSON object.');
      const batch = await ctx.tools.execute({
        agent: exec.agent,
        toolSet: exec.toolSet,
        signal: exec.signal,
        calls: [{
          type: 'tool-call',
          id: `${exec.callId}:tool-index:${++callNumber}`,
          name: tool.name,
          arguments: JSON.stringify(parameters),
        }],
      });
      for (const extra of batch.additionalContexts) exec.deferContext(extra);
      const result = batch.results[0]?.result;
      if (!result) throw new Error(`No result from ${tool.name}`);
      if (result.isError) throw new Error(result.error.message);
      if (batch.concluded || result.concludesTurn) exec.concludeTurn();
      return { content: result.content, meta: result.meta ?? null };
    },
  }));
}
