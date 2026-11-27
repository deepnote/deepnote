---
title: Custom AI instructions
noIndex: false
noContent: false
coverImage: Ap6X0tZPT4eNYXXP6hLs
---

Custom AI instructions tell Deepnote Agent how to work for you and your team. There are two kinds: workspace instructions, which workspace admins set for everyone in a workspace, and your own instructions, which only you see and which follow you to every workspace.

<Embed url='https://www.loom.com/share/bfbca44467664ffdae27d5eccde77a74?sid=c86eaca5-dff2-4a32-91c0-b3f3555dbfaa'/>

## **Accessing custom instructions**

1. Navigate to your workspace **Settings & Members** page
2. Click on the **AI** tab
3. Find the **Custom instructions** card
4. Enter your instructions in **Your instructions**. If you're a workspace admin, you can also edit **Workspace instructions**
5. Click **Save**

Members who aren't admins see only the **Custom instructions** card on the **AI** tab, and only while Deepnote Agent is enabled in the workspace. Guests can't open the **AI** tab.

## **Workspace and personal instructions**

- **Workspace instructions** hold conventions for everyone in the workspace, such as the currency revenue is reported in or when the fiscal year starts. Only workspace admins can edit them. Every member can read them.
- **Your instructions** hold your own preferences. Only you can see them, and they apply in all your workspaces.

Deepnote Agent receives the workspace instructions first and your instructions after them. Both are used in Deepnote Agent, AI in code and SQL blocks, and agent blocks. Each field holds up to 3,000 characters.

Workspace instructions are also used in guests' requests in the workspace's projects, because they belong to the workspace, not to a role. Guests can't read them in settings, but Deepnote Agent can repeat them in its answers, so don't put anything in them that guests shouldn't see.

## **Key features**

- **Personal and shared customization**: Your instructions are specific to your account and aren't shared with your team members. Workspace instructions are shared by everyone in the workspace
- **Persistent behavior**: Once set, the instructions will apply to all your interactions with Deepnote AI across notebooks
- **Flexible configuration**: You can modify instructions to specify:
  - Preferred plotting libraries (e.g., Seaborn)
  - Response formatting
  - Interaction style
  - Code styling preferences
  - Or just making your docstrings sounds uwu

## **Example use case**

Let's look at a practical example:

**Without custom Instructions:**

- When asked to plot data, DeepnoteAI uses default plotting libraries
- Responses follow standard formatting

**With custom instructions:**

# Example instruction

"When you're going to be plotting multiple charts, always use plotly and subplots to plot them in one output. Also I want all of the charts to be green!"

<VideoLoop src="../assets/docs/YZ7UwPGUQGOUQnJOcEmd.mp4" />

### **Best practices**

1. Be specific about your preferences
2. Consider including:
   - Preferred libraries and frameworks
   - Coding style guidelines(suggested to refer to PEP)
   - Communication preferences
   - Output formatting requirements

> Custom Instructions is a powerful way to maintain consistency in your AI interactions and streamline your workflow according to your specific needs and preferences.
