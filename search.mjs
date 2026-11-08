const chinese = new Intl.Segmenter('zh', { granularity: 'word' });

const aliases = [
  [/截(?:个|一张)?图|截屏|屏幕快照|screen\s*shot/g, 'screenshot'],
  [/读取|读出|读一下|打开|查看|read out/g, 'read'],
  [/搜索|检索|查找|查询|找|\b(?:find|lookup)\b/g, 'search'],
  [/写入|写进|保存|存入/g, 'write'],
  [/编辑|修改|改名|更改|update/g, 'edit'],
  [/新建|创建|新增/g, 'create'],
  [/删除|移除|remove/g, 'delete'],
  [/列出|罗列|有哪些/g, 'list'],
  [/合并/g, 'merge'],
  [/发送|发给/g, 'send'],
  [/浏览器|网页|页面|webpage/g, 'browser page'],
  [/资料库|文档库|知识库|备忘录/g, 'resource document'],
  [/过往|历史|之前|上次|记忆|recall/g, 'history memory'],
  [/拉取请求|合并请求|pull requests?/g, 'pr'],
  [/文件夹|目录/g, 'directory'],
  [/配置文件|文件/g, 'file'],
];

const actions = new Set(['screenshot', 'read', 'search', 'write', 'edit', 'create', 'delete', 'list', 'merge', 'send', 'download', 'upload']);
const stop = new Set('a an and as at be by for from i in is it me of on only or that the this to use with you please result tool tools object string number boolean type properties required'.split(' '));
const negation = /不要|无需|不必|禁止|别(?:再|去|用|截图|写入|删除)|\b(?:without|never|do not|don['’]t|no need)\b/i;
const uriPattern = /\b([a-z][a-z0-9+.-]*):\/\/[^\s`"'，。；、）】>]*/gi;

function words(value) {
  const text = value.normalize('NFKC').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const tokens = text.match(/[a-z0-9]+/g) ?? [];
  if (/\p{Script=Han}/u.test(text)) {
    for (const part of chinese.segment(text)) {
      if (part.isWordLike && /\p{Script=Han}/u.test(part.segment)) tokens.push(part.segment);
    }
  }
  for (const [pattern, synonyms] of aliases) {
    if (text.match(pattern)) tokens.push(...synonyms.split(' '));
  }
  return tokens.filter(token => !stop.has(token));
}

export function buildIndex(tools) {
  const postings = new Map();
  let totalLength = 0;

  const documents = tools.map((tool, id) => {
    const shortName = tool.name.split('__').at(-1);
    const nameTerms = words(shortName);
    const description = tool.description ?? '';
    const parameters = JSON.stringify(tool.parameters ?? {}).slice(0, 12_000);
    const schemes = new Set([...`${description} ${parameters}`.matchAll(uriPattern)].map(match => match[1].toLowerCase()));
    const tokens = [
      ...nameTerms, ...nameTerms, ...nameTerms,
      ...words(tool.name),
      ...words(description),
      ...words(parameters),
    ];
    const frequencies = new Map();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    for (const [token, count] of frequencies) {
      if (!postings.has(token)) postings.set(token, []);
      postings.get(token).push([id, count]);
    }
    totalLength += tokens.length;
    return { tool, length: tokens.length, nameTerms, terms: frequencies, schemes };
  });
  const averageLength = totalLength / documents.length || 1;

  function rank(query) {
    const requestedSchemes = new Set();
    const text = query.slice(0, 4000).replace(uriPattern, (_uri, scheme) => {
      requestedSchemes.add(scheme.toLowerCase());
      return scheme;
    });
    const queryTerms = new Set(words(text));
    const scores = new Map();
    for (const term of queryTerms) {
      const matches = postings.get(term);
      if (!matches) continue;
      const idf = Math.log1p((documents.length - matches.length + 0.5) / (matches.length + 0.5));
      for (const [id, frequency] of matches) {
        const lengthFactor = 1.2 * (0.25 + 0.75 * documents[id].length / averageLength);
        const score = idf * frequency * 2.2 / (frequency + lengthFactor);
        scores.set(id, (scores.get(id) ?? 0) + score);
      }
    }
    const normalized = query.trim().toLowerCase();
    return [...scores].map(([id, score]) => {
      const doc = documents[id];
      const exact = doc.tool.name.toLowerCase() === normalized;
      const actionMatch = doc.nameTerms.some(term => actions.has(term) && queryTerms.has(term));
      const schemeMatch = [...requestedSchemes].some(scheme => doc.schemes.has(scheme));
      const objectMatch = schemeMatch || [...queryTerms].some(term => !actions.has(term) && doc.terms.has(term));
      const relevance = score + (actionMatch ? 6 : 0) + (schemeMatch ? 8 : 0);
      return { tool: doc.tool, exact, actionMatch, objectMatch, score: relevance };
    }).sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  }

  function preselect(query, deferred) {
    if (!query || negation.test(query)) return;
    const requestedActions = new Set(words(query.replace(uriPattern, '')).filter(term => actions.has(term)));
    if (requestedActions.size !== 1) return;
    const [first, second] = rank(query);
    if (first && deferred(first.tool) && first.actionMatch && first.objectMatch &&
        first.score >= 4 && first.score >= (second?.score ?? 0) * 1.2) return first.tool.name;
  }

  return { rank, preselect };
}
