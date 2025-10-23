---
title: IPyWidgets in Deepnote
description: We do not support IPywidgets but we offer native alternatives like built-in input blocks for enhanced interactivity in data science notebooks and apps.
noIndex: false
noContent: false
---

Deepnote is a cloud-based data platform that transforms how data teams work together. Built for modern data science workflows, it combines the power of Jupyter notebooks with enterprise-grade collaboration features in a secure environment.

A common tool many data scientists use is **IPywidget,** [an interactive widget library](https://ipywidgets.readthedocs.io/en/8.1.2/) that allows users to build rich, interactive GUIs in Jupyter notebooks. However, IPywidgets are not supported in Deepnote, and here is why, what alternatives you can use to enhance your productivity

## Why IPywidgets are not supported in Deepnote

The primary reason Deepnote doesn't support IPywidgets is security. The platform had to disable IPywidgets functionality due to potential security vulnerabilities that could arise from executing arbitrary JavaScript code in notebooks.

## Alternatives to IPywidgets in Deepnote

While IPywidgets provide an interactive experience, Deepnote offers **native features** and **visualization options** that can achieve the same goals but in a more streamlined manner. Below are some of the ways you can add interactivity and visualization to your Deepnote notebooks:

### **Interactive charts and visualizations**

Deepnote natively supports interactive libraries like **Plotly**, **Altair**, **Seaborn**, and **Matplotlib**, which allow for the creation of dynamic and interactive charts directly in notebooks. These libraries are lightweight and integrate seamlessly with Deepnote’s interface.

- **Plotly** provides powerful charting tools that allow you to zoom, pan, and hover over data points for additional insights.
- **Altair** is another declarative visualization library that automatically renders interactive charts with minimal code.
- **Matplotlib** and **Seaborn** can be used for static charts, but with a bit of customization, you can add basic interactive elements.

### **Deepnote's built-in blocks**

Deepnote has its **blocks**(chart blocks, big numbers, input blocks and more) for interactivity, such as sliders, input boxes, and dropdowns, that can be added to notebooks. These blocks allow you to dynamically control parameters and variables without writing complex code, making them simpler alternatives to IPywidgets.

**Example: Adding a slider to control variables**

Instead of using IPywidgets, you can add a native Deepnote slider to your notebook, which can adjust your data visualization dynamically.
![Nov-29-2024 20-03-45.gif](https://media.graphassets.com/CcwUq7chTTWjVFytIFoB)

In Deepnote, you can insert a **slider input block** next to the code blocks and use that to control elements like the frequency of the sine wave or the range of the x-axis, checkout [app with example](https://deepnote.com/app/deepnote/Slider-example-adb7a9d5-5f07-44a2-9364-8b34714521ba?utm_source=app-settings&utm_medium=product-shared-content&utm_campaign=data-app&utm_content=adb7a9d5-5f07-44a2-9364-8b34714521ba).

### **Parameterize notebook with Deepnote input blocks**

Deepnote’s blocks parameters feature is a powerful way to create reusable and interactive notebooks without needing external libraries like IPywidgets. You can make a parameterised notebook that accepts different inputs to change the analysis or visualization dynamically.

For example, by using dropdowns or text inputs, you can parameterize blocks to automatically update based on user selections.

### **Native forms for collaboration**

For data science teams collaborating in Deepnote, the platform allows users to build **forms** with inputs such as text boxes, sliders, and dropdowns, providing an easy way to make a notebook interactive for both technical and non-technical users. This is particularly useful for teams who may not want to dig into the code but still need to tweak parameters or adjust analyses.

### **Deepnote’s text blocks**

Text blocks in Deepnote allow you to embed **interactive tables, links, and visualizations** directly in your notebooks, making it easy to share your work with stakeholders. While Markdown isn't an exact replacement for IPywidgets, it does provide a clean, simple way to present interactive content without adding code-heavy widgets.

### **Output blocks**

Deepnote notebooks support **dynamic blocks outputs**, which allow you to show or hide certain results or outputs based on block execution. This can be used to create a pseudo-interactive environment similar to what you might achieve with IPywidgets.

While IPywidgets are a popular tool for adding interactivity to Jupyter notebooks, Deepnote decided to do it differently with focus on simplicity, performance, and collaboration. Deepnote provides several powerful alternatives that allow you to build interactive and engaging notebooks and apps without needing to rely on third-party widget libraries.

Whether you are building interactive charts with Plotly or creating parameterized blocks Deepnote ensures that you can add interactivity and dynamic content without sacrificing performance or ease of use.

By exploring Deepnote's built-in tools, you’ll find that you can achieve all the interactivity you need—without the complexity of IPywidgets!
