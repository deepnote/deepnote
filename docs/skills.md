---
title: Skills
description: Teach Deepnote Agent how your team does a task.
noIndex: false
noContent: false
---

A skill gives Deepnote Agent instructions for one kind of task, such as building the weekly revenue report. You write skills as projects in a **Skills** folder, and Agent uses them when a request needs them.

## Create a skill

1. Create a folder named **Skills** in your workspace. Any letter case works, and projects in folders inside it are skills too.
2. Create a project in the folder. The project name is the skill name.
3. Write the instructions in a notebook named **SKILL**. Without one, Agent uses the project's first notebook other than the init notebook.

Start the SKILL notebook with a text block that says what the skill does and when to use it. Agent reads this description to decide whether a request needs the skill. The block can use SKILL.md front matter:

```markdown
---
name: weekly-revenue-report
description: Builds the weekly revenue report from the finance tables. Use it when someone asks for weekly revenue.
---
```

Agent reads the `description`. The skill name always comes from the project name. Without front matter, the whole first text block is the description.

The project's other notebooks are reference notebooks. Agent loads one only when the skill points to it, so mention it by its notebook name in the instructions. Reference notebooks are a good place for long examples and lookup tables.

## What Agent reads

Agent reads text, code, and SQL blocks. It doesn't read block outputs, charts, inputs, or other blocks. Agent reads up to about 10,000 tokens of a notebook and cuts the rest.

Keep descriptions short and specific. When a workspace has many skills, Agent sees shorter descriptions, or only the skill names.

## Use a skill

Agent finds and loads skills on its own when a request needs them. To use a specific skill, name it or @-mention its project in your message. A loaded skill applies for the rest of the chat, unless you say otherwise.

## Who can use and edit skills

- Everyone who can view a project in a Skills folder can use it as a skill.
- Everyone who can edit the project can edit the skill.
- A private project in a Skills folder is a personal skill. Only you and the people you share it with can use it.

## Changes to skills

- A new skill is available in chats that you start after you add it. A running chat can find it later, for example after you switch notebooks.
- When you edit a skill that Agent already loaded, Agent uses the new text the next time it loads the skill.
- When you rename or delete the Skills folder, or move a project out of it, Agent can no longer load those skills. When you move a project into a Skills folder, it becomes a skill.
