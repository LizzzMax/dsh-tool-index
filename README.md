# DSH Lean Context

Local tool discovery for DeepSeek Harness. The plugin builds a per-agent in-memory keyword index from the tools admitted for the current step. It ranks names, descriptions, parameters, action aliases, and URI schemes. A clear action and object match can expose one deferred tool directly. Otherwise `dsh_search_tools` returns up to three candidates and `dsh_call_tool` invokes the chosen tool through DSH's normal executor and step admission.

## Profile setup

In DSH Web, open **Settings → Plugins → Add Plugin**, then paste the package URL from the [latest release](https://github.com/LizzzMax/dsh-tool-index/releases/latest). You can also install the downloaded `.tgz` or this source folder as a local package. Enable the `dsh-tool-index` bundle in your profile.

Use one tool-disclosure bundle per profile. This bundle replaces the default native executor entry and delegates actual calls to DSH's native executor. The verified profile for `0.1.0` is DSH `0.2.2-rc.1` in Web Standard mode.

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
