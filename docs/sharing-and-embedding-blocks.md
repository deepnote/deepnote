---
title: Sharing and embedding blocks
noIndex: false
noContent: false
---

Deepnote supports sharing or embedding the code and output of individual blocks. **Once shared, the embed gets automatically refreshed based on the changes in your notebook!** To turn on sharing, select a block and click **`Share block`** on the right-hand side. The appearing pop-up window will allow you to select which part of the block you'd like to share: code only, output only, or both. _Keep in mind that the block won't be shared until you turn on the toggle switch up top._

<VideoLoop src="../assets/docs/C9ycTxfQR6V4I8Mps2iW.mp4" />

<Callout status="info">
You can quickly tell which blocks are being shared by the **Live** button in the top right corner of shared blocks.
</Callout>

## Sharing blocks via URL

If you'd like to quickly share an individual block's code and/or output via URL, all you need to do is copy the link in the **`Share block`** box. Then, to view the shared block, paste the link into the address bar in your browser of choice. _Note that anyone with the link can view the shared block content, not only collaborators on your Deepnote project!_

<VideoLoop src="../assets/docs/Tv0DFr6gRVGABYg9Ytic.mp4" />

## Embedding blocks on Medium / Notion

Embedding Deepnote blocks into Notion pages is as easy as 1,2,3. All you need to do is copy the link in the **`Share block`** box, paste it into your Notion page, and hit **`Create embed`**... and ta-da! You can also resize the embedded block to make your Notion page look (even) better.

<VideoLoop src="../assets/docs/9pNtfLOSMKUIzTVq2pZw.mp4" />

<Callout status="info">
If you love Notion as much as we do, check out [this page](https://medium.com/deepnote/bringing-analytics-to-notion-with-deepnote-b262a300c6de) describing even more cool ways to integrate Deepnote with Notion!
</Callout>

Embedding Deepnote blocks into Medium articles is very straightforward. Simply copy the link in the **`Share block`** box, paste it into your Medium article, and you're set!

<Callout status="warning">
Medium currently does not allow for custom image resizing, which might make your embedded blocks look a tad bit weird, but don't fret. To rectify this issue, edit the **`?height`** and **`?width`** parameters in the copied URL.
</Callout>

<VideoLoop src="../assets/docs/uX2oa8aJQPO60E28qWyg.mp4" />

## Embedding Deepnote blocks using `<iframe>`

If the options above are not for you but you'd still like to embed your Deepnote blocks into websites, look no further. Deepnote provides you with a default `<iframe>` tag that you can customize as you please. The two most important attributes:

- `height`: Customize the height of your `<iframe>`
- `width`: Customize the width of your `<iframe>`

Click on **Run Pen** below to see `<iframe>` embedding of Deepnote blocks live in a CodePen embed (insert Inception meme here).

<Embed url="https://codepen.io/lksfr/pen/MWvRVQX" />
