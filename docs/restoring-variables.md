---
title: Restoring variables
noIndex: false
noContent: false
---

When you return to your notebook after your machine went offline (eg. due to a period of [inactivity](https://docs.deepnote.com/environment/long-running-jobs#how-deepnote-decides-when-to-turn-off-hardware-of-a-project)) you will usually have an option to restore variables from your previous session.

If you wish to do so, click on the restore variables button displayed in the notebook's status bar at the top. This will restore **all the variables from your previous session** in the state they were at when your hardware was shut down.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FPbXFd40wc86xmOGCNS7x%2Fimage.png](https://media.graphassets.com/IDFZ08DSRZyKtKaaa37f)

There are a couple of limitations to keep in mind:

- **Restoring variables is not always possible**. We only display the restore option if we could successfully save all your variables in your previous session.
  The most common reasons for not being able to save session context are:
  - the given variable may be too large;
  - the variable type is not supported (eg. `SparkContext`, and tensorflow `StackSummary`).
- You can only restore variables **before starting your machine**. If you execute a block without restoring variables first then you will lose access to your previous context and your stored variables will be deleted.
