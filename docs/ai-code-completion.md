---
title: Code completion
description: Boost your efficiency with real-time code suggestions powered by Deepnote AI.
noIndex: false
noContent: false
---

Enhance productivity and streamline your workflow with context-aware code suggestions and completions as you type. Whether you are cleaning data, crafting complex algorithms, or fine-tuning a machine learning model, our code completion is designed to assist you, cutting back on the monotony of writing repetitive code and speeding up your coding process.

<Callout status="info">
Deepnote AI code completion is available on **all** plans.
</Callout>

## Enabling code completion

In order to take advantage of code completions, you need to have this feature enabled for your workspace. Go to **Settings & Members** and click on **AI**. When **AI code completion** is turned on, every editor and admin user in the workspace will see code completions displayed in all of the projects.

![project setting.png](https://media.graphassets.com/Gxq7HPf3Q5hFym9apHYP)

<Callout status="warning">
To provide code suggestions, Deepnote AI processes the content and metadata of the notebook. This can include code, text and metadata of variables (column names). None of this data is stored outside of Deepnote or used for model training purposes. If you have concerns about processing sensitive data via large language models, you can disable code completions.
</Callout>

## Toggling code completion for individual users

If you prefer to disable code completion for yourself only, you can do so in the block actions menu:

![CleanShot 2023-12-12 at 16.53.04@2x.png](https://media.graphassets.com/O59w9WuRK6EK9WI76WV4)

This will affect code completions in all your notebooks, but other workspace members will be unaffected.

## Working with completions

Once it's enabled, you can see code suggestions appearing real-time as you type in **code or SQL blocks**. You can accept suggestions by pressing `Tab`.

![outliers (1).gif](https://media.graphassets.com/C46TjJ8QPqLlhDH0Oi3U)

Suggestions are **context-aware**: the content in previous code and text blocks in the notebook will be taken into account to provide more relevant suggestions. You can try to prompt code suggestions by providing a textual description of what you want to achieve. You can put that in a text block or in a comment in the code as well.

![visualization (1).gif](https://media.graphassets.com/GO6HEOFFQOO659C6sxeh)

Suggestions work in **SQL blocks** as well. Similarly to Python code, SQL query completions also utilize your notebook as context, along with any relevant SQL blocks using the same integration in other notebooks within your workspace. This means that the more details you have in your notebook and the more work you do with the given data source, the more relevant the suggestions will become.

![2023-08-15 15.32.02 (1).gif](https://media.graphassets.com/L7sdHuk4TXy4n6yXweof)

_Watch it all come together in our 3-minute demo below._

<Embed url='https://www.loom.com/share/f9b7a0058b3648cf801431f761a84eaa?hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true' />
