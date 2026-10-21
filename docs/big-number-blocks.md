---
title: Big number blocks
description: Important metrics deserve a big number
noIndex: false
noContent: false
---

Use a big number block to display one metric in a notebook, app, or dashboard.

![CleanShot 2024-09-17 at 13.18.26@2x.png](../assets/docs/jrloPDWaTkSYpdCk3lfq.webp)

You can add a big number block by pressing the **add block (+)** button between blocks and selecting the "Big number" option from the menu.

<VideoLoop src="../assets/docs/I4in5gzTQsCyUsXGxswx.mp4" />

The title block supports interpolating Python variables using Jinja-style brackets. For example: _"Sales in &#123;&#123;month&#125;&#125;"_.

You can choose any variable available inside the notebook for the value you want to display.

The big number chart has different formatting options, including:

- Number
- Currency
- Percent
- Scientific
- Financial

## Comparisons

Add a comparison to show how the metric differs from a previous value.

There are a few different ways to do the comparison:

- Absolute change: The difference between the current and previous values.
- Percentage change: The percentage difference between the current and previous values.
- Absolute value: The current value compared to a fixed reference value.
