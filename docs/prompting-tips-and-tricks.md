---
title: Prompting tips and tricks
description: Learn how to effectively structure your prompts in order to get the most out of Deepnote AI and fully utilize its deep contextual awareness.
noIndex: false
noContent: false
---

# Fundamentals of effective prompting

Deepnote AI is powered by OpenAI’s latest models. Here are a few general tips on how to improve your prompts for better results.

### Be specific and include details

Be as specific as possible when writing your instructions. By including details in your prompt, you minimize the chances of the model filling in too many blanks for you. Stating your higher level goal is as important as pointing out concrete methods or functions that you expect to be used. For example:

1. Mention the specific Python package you want to use

```python
# ❌ Don't do
Train a machine learning model

# ✅ Instead do
Train a logistic regression on the training data with sklearn
```

2. When plotting a chart, describe how you would like it to look like

```python
# ❌ Don't do
Plot a chart of the data

# ✅ Instead do
Plot total_sales against time on a stacked line chart for every continent
```

3. Specify the length of the desired output

```python
# ❌ Don't do
Read the CSV file

# ✅ Instead do
Read the first 100 rows from events.csv
```

### Use appropriate structure and formatting

Leverage formatting for a clearer structure and highlighting the key parts of your prompt. For example, you can make use of operators to outline relationships between parts of the prompt or enclose a value in quotation marks to ask for literal values.

![effective_prompting-text_formatting.gif](https://media.graphassets.com/PhCOmOTNSdC8rp3QrIoV)

If the problem is complex, you can point out the necessary steps as individual bullet points or numbered points if they need to be completed in a certain order. We recommend breaking down your problem into subproblems and tackling these with individual prompts instead of all at once.

### Provide examples

One of the most effective prompting techniques is “few-shot” prompting. This entails including relevant examples in your prompts that demonstrate to the AI exactly how it should approach solving your problem. This becomes especially useful when expecting a specific output from Deepnote AI, as it needs to understand the relevant schema beforehand.

# Advanced prompt techniques

Use the following advanced techniques to fully utilize Deepnote AI’s abilities to understand the context of your workspace.

### Leveraging notebook contents

Deepnote AI factors in the contents of your notebook in its outputs. You can take advantage of this and write out relevant semantic information or business logic directly into your notebook so that Deepnote AI can follow these instructions. Bonus tip: try placing the most important instructions closer to where Deepnote AI is working to prioritize them within its context. This strategy works especially well in SQL blocks. Notice how Deepnote AI picks up on our search query for companies in the financial sector:

![effective_prompting-additional_instructions.gif](https://media.graphassets.com/AuuKD2GSLqUHyUKx4YHl)

### Referencing notebook variables and files

One of the most powerful features of Deepnote AI is the ability to reference your existing variables and files directly in your prompts. Simply mention variables by name and Deepnote AI will pick them up, including their data type. In case of a DataFrame, Deepnote AI also has access to its columns and their respective data types. When referencing a file, Deepnote AI will check existing notebook variables and automatically import it if it’s missing.

![effective_prompting-variable_referencing.gif](https://media.graphassets.com/7RxCHAc4S3edFX7vsbLw)

### Iterative prompting

It’s possible that Deepnote AI doesn’t get things right on its first try. If that’s the case, there are several ways you can iteratively achieve your desired output:

1. **Adjust your current prompt**

   Clicking _Undo_/_Delete blocks_ will take you a step back, giving you the ability to edit your prompt. This is perhaps the simplest way to make iterative changes.

2. **Prompt Deepnote AI again**

   If you want to start from scratch, you can always trigger Deepnote AI again in the next block. This is also useful when you want Deepnote AI to continue whatever it was working on prior.

![effective_prompting-continue_prompt.gif](https://media.graphassets.com/CwpNQV74SiDzV6whpMD7)

3. **Follow up on your previous prompts**

   In some cases, you may need Deepnote AI to remember its previous outputs. If you accept your previous Deepnote AI outputs, this will help Deepnote AI remember what it has already tried or you can point out yourself exactly what’s wrong with its previous approaches.

4. **Provide more context**

   Apart from these tips, Deepnote AI itself might ask for more information about your problem. In such a case, it’s valuable to utilize Deepnote AI’s thinking, accept the current generation by clicking _Accept/Done_ and ask Deepnote AI to continue in a follow up prompt.

### Combining all Deepnote AI features

Deepnote AI consists of several features, each tailored for a specific use case. To truly make the most out of Deepnote AI, make sure you’re using the strengths of each one.

Auto AI shines in getting you started by generating multiple blocks as well as executing them. With a simple prompt, you will have a solid foundation to build from in no time. It’s also great for exploring possible solutions so you can then prompt it with your hypothesis and quickly check whether it’s worth pursuing further.

Once you’re happy with exploration, you can use the Edit command for granular editing and polishing of your notebook.
