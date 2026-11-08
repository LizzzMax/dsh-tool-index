import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIndex } from '../search.mjs';

const tool = (name, description) => ({ name, description, parameters: { type: 'object' } });
const definitions = [
  tool('read', 'Read a file in the local workspace.'),
  tool('edit', 'Edit a file in the local workspace.'),
  tool('mcp__browser__screenshot', 'Capture a screenshot of the current browser page.'),
  tool('mcp__browser__read', 'Read the text of the current browser page.'),
  tool('mcp__archive__read', 'Read a document at an archive:// resource URI.'),
  tool('mcp__archive__write', 'Write a document at an archive:// resource URI.'),
  tool('mcp__mail__search', 'Search email messages in a mailbox.'),
];
const deferred = tool => tool.name.startsWith('mcp__');
const index = buildIndex(definitions);

test('preselects by action and object without the user naming the tool', () => {
  assert.equal(index.preselect('把当前网页截个图', deferred), 'mcp__browser__screenshot');
  assert.equal(index.preselect('Read the memo at archive://memos/decisions.txt', deferred), 'mcp__archive__read');
});

test('leaves local, vague and negative requests to the regular tool surface', () => {
  for (const query of ['Edit a file in the local workspace', '看看这里有什么问题', '不要给当前网页截图']) {
    assert.equal(index.preselect(query, deferred), undefined, query);
  }
  assert.deepEqual(index.rank('zxqvxyz'), []);
});

test('supports exact discovery and ranks a read above a write for the same resource', () => {
  assert.equal(index.rank('mcp__mail__search')[0].tool.name, 'mcp__mail__search');
  assert.equal(index.rank('read archive://memos/decisions.txt')[0].tool.name, 'mcp__archive__read');
  const admitted = buildIndex(definitions.filter(tool => tool.name !== 'mcp__archive__read'));
  assert(!admitted.rank('read archive://memos/decisions.txt').some(hit => hit.tool.name === 'mcp__archive__read'));
});

test('compares explicit resource reads against readers of the same scheme', () => {
  const query = '读取外部资料库里的这份备忘录 archive://memos/decisions.txt，只返回文件里的校验码。';
  const writer = tool('mcp__archive__write_memo', '写入外部资料库里的备忘录文件和校验码。 Use an archive:// URI.');
  const withWriter = buildIndex([...definitions, writer]);
  assert.equal(withWriter.preselect(query, deferred), 'mcp__archive__read');

  const secondReader = tool('mcp__backup__read', 'Read a document at an archive:// resource URI.');
  const withTwoReaders = buildIndex([...definitions, writer, secondReader]);
  assert.equal(withTwoReaders.preselect(query, deferred), undefined);
});
