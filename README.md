# DSH Lean Context

Local tool discovery for DeepSeek Harness. The plugin builds a per-agent in-memory keyword index from the tools admitted for the current step. It ranks names, descriptions, parameters, action aliases, and URI schemes. A clear action and object match can expose one deferred tool directly. Otherwise `dsh_search_tools` returns up to three candidates and `dsh_call_tool` invokes the chosen tool through DSH's normal executor and step admission.

## Token benchmark

| Task | Prior lazy dispatcher | DSH Lean Context | Tokens saved | Model requests |
| --- | ---: | ---: | ---: | ---: |
| Short reply with no tools | 11,835 | 10,741 | 1,094 (9.2%) | 1 → 1 |
| Update six local files | 63,630 | 46,781 | 16,849 (26.5%) | 5 → 4 |
| Read a resource through MCP | 36,443 | 21,986 | 14,457 (39.7%) | 3 → 2 |
| **Total** | **111,908** | **79,508** | **32,400 (29.0%)** | **9 → 7** |

Each task ran once in each isolated profile using DSH `0.2.2-rc.1`, Web Standard, and `gpt-6.1-sol` at medium reasoning. Both profiles included OpenViking. The comparison used Lean Context `0.1.0` and `dsh-tool-lazy-dispatcher` `1.2.0` with a local compatibility patch. Totals include input and output tokens, with cached input counted in the input total.

For the MCP task, the prompt specified a resource URI and a reading goal. Lean Context preselected the reader, so the model called it directly and retrieved the expected value. In the file task, the baseline also spent one request on `pwd`, while Lean Context started with `glob`. Request counts can vary with the model's execution path.

## Profile setup

In DSH Web, open **Settings → Plugins → Add Plugin**, then paste the package URL from the [latest release](https://github.com/LizzzMax/dsh-tool-index/releases/latest). You can also install the downloaded `.tgz` or this source folder as a local package. Enable the `dsh-lean-context` bundle in your profile. In DSH Web you can also install by entering `dsh-lean-context` as the npm package name.

For upgrades from a GitHub release through `0.1.1`, remove the old `dsh-tool-index` bundle before enabling `dsh-lean-context`.

Use one tool-disclosure bundle per profile. This bundle replaces the default native executor entry and delegates actual calls to DSH's native executor. The verified profile is DSH `0.2.2-rc.1` in Web Standard mode.

The defaults defer `mcp__` tools and keep other tools visible. Override `deferredPrefixes` to include other tool families and `pinnedTools` to keep specific tools visible.

```yaml
- id: tool-index
  config:
    deferredPrefixes: ["mcp__"]
    pinnedTools: ["mcp__browser__screenshot"]
```

Run `npm test` in this folder to check keyword ranking, conservative preselection, and exact discovery. The retrieval runs in memory and does not require an embedding service or a separate model request.

## Example

Ask “Take a screenshot of the current web page” or “Read the memo at this resource URI.” A clear action and object can preselect a matching tool without the user naming it. Ambiguous requests can use the search tool. Each search and call sees only the tools admitted for that DSH step.

Welcome to try it. [Issues and feedback](https://github.com/LizzzMax/dsh-tool-index/issues) are welcome, especially queries that selected an unexpected tool.
