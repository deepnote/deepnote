---
title: Data privacy
description: Learn how Deepnote AI processes data securely, providing granular privacy controls.
noIndex: false
noContent: false
---

### How is your data processed?

Deepnote AI processes the content and metadata of the notebook via its partner LLM providers (such as OpenAI). This data can include **code**, **text**, **metadata of variables** (column names) within the notebook and your **database schema** for [SQL AI](https://deepnote.com/docs/sql-generation).

<Callout status="info">The processed content is **not used for model-training purposes** (your code cannot leak into suggestions displayed for other companies).</Callout>

### What about outputs?

You have the option to control whether you would like to share the **outputs of block executions** with OpenAI. If you turn on the '**Provide access to block outputs**' switch, Deepnote AI will be able to read the outputs in your notebook, greatly enhancing the relevance of its suggestions.

![deepnote ai outputs setting.png](https://media.graphassets.com/oSvfKdSTVu52VR599r9w)

<Callout status="warning">Please note that outputs can include **row-level data from your DataFrames** or other variables. If your outputs may include data you do not wish to process via an LLM provider, you can disable this option. You will still be able to take advantage of Deepnote AI features that do not depend on accessing outputs.</Callout>

### Where is your data stored?

The context sent can be processed in the US and worldwide. OpenAI may keep the context data for up to 30 days for safety monitoring purposes, after which it's automatically deleted. See more details [here](https://openai.com/policies/api-data-usage-policies).
For certain providers, data processed for real-time code suggestions is not stored at all under zero-retention agreements.

### Working on sensitive projects?

If you're working on a sensitive project and have concerns about processing any code, text or data through LLMs, admins can disable Deepnote AI in **Settings & Members** → **AI**. This will prevent any data from being sent for processing and Deepnote AI features won't be available in your workspace.
