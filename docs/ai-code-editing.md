---
title: Code editing
description: Refine your code efficiently with Deepnote AI's editing suggestions.
noIndex: false
noContent: false
---

Need to revise your code, refactor it, or make it more readable? Deepnote AI can help edit any existing code. Just click on **Open Deepnote AI** in the block sidebar and simply tell Deepnote AI how you want your code to be edited.

![docs-code_editing-medium.gif](https://media.graphassets.com/dnVYuRGoQveEYxSRgC0N)

Edited code will be displayed side by side of the original code in a diff view so you can easily see what's been changed. Press the **Run code** button to see the new code in action. If you're satisfied, press **Done** to accept the code. If the generated responses does not suit your needs, you can **Discard** all of the edits, returning to the state before you started editing with AI.

![CleanShot 2024-05-21 at 14.12.04@2x.png](https://media.graphassets.com/tuSvbyKZQLmX9Fpggfog)

<Callout status="info">**Pro tip**: When the diff view is presented by Deepnote AI, the active state of the block is automatically set to that of the new suggestion. Therefore, if you were to run the whole notebook, the AI suggestion would get executed even if you have not accepted the suggestion before. This behaviour is slightly different from other code editor applications, but rest assured, you can always Discard the change if you want to get back to your original state.</Callout>

### Iterating with follow-up prompts

![docs_code-iterative-editing-medium.gif](https://media.graphassets.com/Zg7wRnddSmmmHcyPEtVs)

If the suggested code does not suit your needs, you can immediately type in a new prompt as a follow-up to further edit it. Each prompt, including your follow-ups is added to the prompt edit history. If you wish to revert to a previous stage in your editing flow, you can simply click on the desired step from the list of your prompts, returning the block to that specific state. This allows you to effortlessly compare results across different prompts and continue with the most promising options.

<Callout status="info">**Pro tip**: With prompt history you are essentially having an isolated mini-chat with the AI, where all of the context of your prompts and AI outputs is preserved, so you can use short instructions as you would in a chat. For instance, if something doesn’t quite work, you can just say "try another option," and the AI will understand how to proceed.</Callout>

### SQL blocks

You can also use Deepnote AI to edit your SQL queries. Just click on Deepnote AI in a SQL block and tell Deepnote AI how it should edit your existing SQL code. Behind the scenes, Deepnote AI will inspect and use your database schema to better understand the written SQL code. [Read more](https://deepnote.com/docs/sql-generation)

![sql_ai-editing_sql.gif](https://media.graphassets.com/Tj1weG0TTtaBZrjjvpNK)
