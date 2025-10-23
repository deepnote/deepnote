---
title: Modules
description: Turn notebooks into reusable workflows
noIndex: false
noContent: false
---

Modules in Deepnote allow you to **transform your notebooks into reusable workflows** that can be shared across your workspace. This powerful feature solves the common challenge of code fragmentation and inconsistent analysis by enabling you to package essential elements—code snippets, SQL queries, data transformations, and visualizations—into standardized, reusable components.

With modules, you can adopt a "build once, use everywhere" approach, ensuring your team leverages consistent tools and methodologies without duplicating efforts. Whether you're working with complex data cleaning routines or custom visualization functions, modules make your best work instantly accessible throughout your workspace.

<Embed url='https://www.loom.com/embed/c9c4055c581b47ea91882bd9202215c0?sid=5acc205b-a54f-48bc-a060-80d289331511'/>

## Use Cases

Modules open up numerous possibilities for streamlining your data workflows:

- **Semantic layer for KPIs**: Ensure everyone calculates metrics like churn rate or weekly active users consistently
- **Modular ETL pipelines**: Break complex transformations into logical steps that are easier to maintain and debug
- **Code reusability**: Share common functions, visualization code, and data processing logic across projects
- **ML experimentation**: Package machine learning models to test consistently across different datasets and parameters

## Creating a Module

Turning a notebook into a module is a straightforward process:

Open the notebook you want to convert into a module and click the **create module button** in the notebook's upper right corner. Confirm your intent by pressing the ‘**Publish as a module**’ button.

![CleanShot 2025-03-12 at 10.27.05.png](https://media.graphassets.com/VrXQjqEHSlKuOPxdbnjY)

At this point, your notebook is turned into a module! However, to make it useful, there’s an extra step needed: you need to **select which blocks you want to export** as the output of the module. You can do this by going to a code or SQL block and clicking the **export block** action.

Then you can give the exported block a descriptive name and you’re done!

![CleanShot 2025-03-12 at 10.45.18.png](https://media.graphassets.com/mWb9QjvVQXCkuxpOaDzt)

You can export as many blocks as you wish from a single module. The **output of all exported blocks will be available** when others import your module.

It's important to note that exported outputs can differ based on the given block's type:

- If you export a SQL block, the returned output will always be a DataFrame
- In case of code blocks, the output will be the last returned variable within the code block
- When exporting a function, ensure the function object is returned on the last line of the code block

![CleanShot 2025-03-12 at 10.47.39.png](https://media.graphassets.com/APQrmKGSQSKRLdn82Dlp)

**Adding Parameters**

To make your module configurable, include input blocks in your notebook. These will automatically become parameters that users can set when importing your module. For example, if you add a select input linked to a SQL block, users of the module will be able to customize the returned results based on their selection (such as filtering by pricing plan).

![CleanShot 2025-03-12 at 10.50.49.png](https://media.graphassets.com/IMAjlTv5TVyEo6PwxPA5)

## Importing a Module

Using modules in your own notebooks is simple:

1. Click the **module button** in the notebook footer
2. Search for the module by project or notebook title
3. Configure the module:
   - Set any required input parameters
   - Choose which exported blocks to import
   - Optionally rename returned variables to fit your current notebook's naming conventions

![2025-03-11 17.39.25 (1) (1).gif](https://media.graphassets.com/2nmctbQTUuzanKWXNsts)

When you run the module block, it executes in a **separate environment** and returns your selected exports. All returned variables are automatically added to your current notebook's memory, seamlessly integrating with your existing work.

**Special note on functions**

When importing a Python function from a module, it's important to understand that **the function is executed in the context of the consuming notebook**. This means that global variables, integrations, and other environmental elements from the source module used within the imported functions may not be available in your current notebook.

Make sure any dependencies required by your imported functions are either:

- Explicitly passed as parameters to the function
- Explicitly imported within the function itself
- Already available in your current notebook environment

This behavior differs from other module exports which execute in the module's own environment before returning their results.

## Module Library

Access all published modules through the **Modules section** in your workspace navigation sidebar. This centralized location makes it easy to discover and utilize the collective knowledge and tools created by your team.

![CleanShot 2025-03-12 at 14.38.09.png](https://media.graphassets.com/x6lfbP6nQj0AlzQxbuJc)

The module library provides valuable information about each module:

- Source project and notebook
- Creator
- Projects currently using the module

This visibility helps you understand the impact and reach of each module across your workspace.

## Updating modules

If you wish to update a module, you can do so easily by modifying the source notebook. Any changes you make will be **automatically propagated** to all other notebooks that import the updated module upon its execution.

In case there's a change affecting the configuration of the module (for instance, a new input parameter), these changes will be flagged visually in the module block before execution, giving you an opportunity to review and adjust the configuration as needed.

![CleanShot 2025-03-12 at 14.48.22.png](https://media.graphassets.com/D6EWWrmJRqqAR2WhG3nQ)

## AI Support for Modules

Deepnote AI seamlessly integrates with modules, enhancing analytical capabilities while maintaining consistency across your workspace.

### Teaching Deepnote AI with Your Modules

When you build a semantic layer with modules—defining your KPIs and metrics in a trusted, consistent way—you're not just helping your team, you're also teaching Deepnote AI. This integration creates a powerful workflow where AI leverages your established definitions rather than calculating metrics from scratch.

![2025-03-20 11.00.02 (1).gif](https://media.graphassets.com/UounpvDOT3maVeztX8V9)

### How It Works

When you ask analytical questions in Deepnote AI, the system follows a thoughtful approach:

1. **Module Library Check**: AI first checks your module library for existing trusted definitions relevant to your query
2. **Automatic Module Selection**: It identifies and selects the appropriate module for your analytical needs
3. **Parameter Adjustment**: Parameters are automatically configured based on your specific question
4. **Foundation-Based Analysis**: The analysis is built upon your established modules rather than creating new calculations

## Current Limitations

While we continue to enhance modules, there are a few current limitations to be aware of:

1. **Caching**: Imported modules always run with each execution, with no option to cache results. This feature is on our roadmap.
2. **Passing data to modules**: Currently, you can only pass parameters based on input blocks in the notebook. For cases where you need to pass a DataFrame to a module (such as a charting function), the current solution is to import the function first and then call it on your DataFrame in the current notebook.
3. **Output types**: Exports are currently limited to variables. This means you cannot export HTML outputs like charts directly as module outputs. We're working on expanding the supported output types.

We're actively working on addressing these limitations in future updates based on user feedback.
