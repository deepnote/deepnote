---
title: Sharing and embedding blocks
noIndex: false
noContent: false
---

Deepnote supports sharing or embedding the code and output of individual blocks. **Once shared, the embed gets automatically refreshed based on the changes in your notebook!** To turn on sharing, select a block and click **`Share block`** on the right-hand side. The appearing pop-up window will allow you to select which part of the block you'd like to share: code only, output only, or both. _Keep in mind that the block won't be shared until you turn on the toggle switch up top._

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FhxbxGjbSdyFJCZcYbrJE%2FCleanShot%202022-03-30%20at%2014.31.15.gif](https://media.graphassets.com/C9ycTxfQR6V4I8Mps2iW)

<Callout status="info">
You can quickly tell which blocks are being shared by the **Live** button in the top right corner of shared blocks.
</Callout>

## Sharing blocks via URL

If you'd like to quickly share an individual block's code and/or output via URL, all you need to do is copy the link in the **`Share block`** box. Then, to view the shared block, paste the link into the address bar in your browser of choice. _Note that anyone with the link can view the shared block content, not only collaborators on your Deepnote project!_

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2F5IPLlFEOO1Iizmr2GSp3%2FCleanShot%202022-03-30%20at%2014.39.23.gif](https://media.graphassets.com/Tv0DFr6gRVGABYg9Ytic)

## Embedding blocks on Medium / Notion

Embedding Deepnote blocks into Notion pages is as easy as 1,2,3. All you need to do is copy the link in the **`Share block`** box, paste it into your Notion page, and hit **`Create embed`**... and ta-da! You can also resize the embedded block to make your Notion page look (even) better.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FcBJNHovCACYcnlOYpT2x%2FCleanShot%202022-03-30%20at%2014.44.32.gif](https://media.graphassets.com/9pNtfLOSMKUIzTVq2pZw)

<Callout status="info">
If you love Notion as much as we do, check out [this page](https://medium.com/deepnote/bringing-analytics-to-notion-with-deepnote-b262a300c6de) describing even more cool ways to integrate Deepnote with Notion!
</Callout>

Embedding Deepnote blocks into Medium articles is very straightforward. Simply copy the link in the **`Share block`** box, paste it into your Medium article, and you're set!

<Callout status="warning">
Medium currently does not allow for custom image resizing, which might make your embedded blocks look a tad bit weird, but don't fret. To rectify this issue, edit the **`?height`** and **`?width`** parameters in the copied URL.
</Callout>

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FgfpYT18WtsCUH3Iy9Oo5%2Fembed4%20(1).gif](https://media.graphassets.com/uX2oa8aJQPO60E28qWyg)

## Embedding Deepnote blocks using `<iframe>`

If the options above are not for you but you'd still like to embed your Deepnote blocks into websites, look no further. Deepnote provides you with a default `<iframe>` tag that you can customize as you please. The two most important attributes:

- `height`: Customize the height of your `<iframe>`
- `width`: Customize the width of your `<iframe>`

Click on **Run Pen** below to see `<iframe>` embedding of Deepnote blocks live in a CodePen embed (insert Inception meme here).

<Embed url="https://codepen.io/lksfr/pen/MWvRVQX" />
