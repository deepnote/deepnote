---
title: Data apps
description: Some analyses are best presented with the journey to get there, while others call for a more polished interface. You may wish to hide some code blocks so they don’t distract from the story you are trying to tell, or parametrize the notebook with a couple of inputs so your audience knows which knobs to turn. With Deepnote, you can now create stunning apps that will impress your CEO.
noIndex: false
noContent: false
---

![Apps 2.png](https://media.graphassets.com/6ecwQuqREaUWb33uWO8g)

### How to create an app

To publish a project as an app, open the notebook you would like to publish and select **Create app** in the top right corner.

Next, click the **Add all blocks** button to add all blocks to the app, or add blocks individually by using the **Add block to app** button in the top right corner of your blocks.

For executable blocks you can choose to only display the output, the code, or both.

In the App settings, you can use toggles to **Hide all code blocks**, **Make app full-width**, or **Show table of contents**.

<Callout status="info">
Note there can be only **one**  app per project. In order to create more apps split your work across multiple projects.
</Callout>

### App sharing settings

Just like you can set the [sharing settings for projects](/docs/share-projects), you can set the access controls for your app. For example, it is possible to have a private project with a public app. In this case, no one will be able to open and edit your project; however, the app will be visible to anyone.

Visibility of the app can be set through the **Permissions** dropdown in the _App settings._

The following access levels are available:

- **Workspace & collaborators.** The only people who can access the app are the ones who have access to the original project. This will depend on your [project sharing settings](/docs/share-projects).
- **Anyone with a link.** Only people with whom you share the link can access the app. It is hidden from your public profile and search engines.
- **Public.** Your app is visible in your public profile and can be indexed by search engines. This is useful if you would like others to come across your work.

It is important to note that these settings apply to all the content within the notebooks, regardless of the visibility of individual blocks. Even if certain blocks are hidden within the notebook, the content of these hidden blocks remains accessible to those who have access to the app. This means that sensitive or private data within hidden blocks is not excluded from the access permissions set for the app. You should be mindful of this when deciding what information to include in notebooks linked to apps with broader access settings.

### Live updates

Changes in the notebook are now automatically saved to your app to improve your development speed.

There are three ways to make changes to already published apps:

1. **Small updates.** You can simply edit the notebook to make immediate changes to the app. The app viewers will need to refresh the tab in order to see them.
2. **Duplicating the notebook and bringing changes over.** For larger changes, you may wish to first prepare them in a copy of the notebook, and once you are satisfied, you can paste them over to the original notebook.
3. **Duplicating the notebook and republishing it.** If you want to ensure that your app is in a working state at all times, prepare them in a copy of the notebook, and once you are satisfied, publish the new notebook. Block visibility and other configuration options will be preserved, you only need to check how you want to display any new blocks you added. The link to the app will remain the same.

### Modifying the layout

The layout of an app can be modified independently of the notebook layout via the app preview pane. Simply drag and drop multiple blocks next to each other to organize your work. Changing the layout of an app does not affect the notebook layout.

Don't forget that you can organize blocks into columns! First create a row of blocks by dropping them next to each other. Then, drag and drop other blocks below the cells to create a column. This is useful for creating layouts that should render side-by-side on large screens, but stack vertically on smaller screens, like smartphones.

You can change the width of a block or column by dragging the border between the blocks.

Complex layouts work best when combined with the "full-width" setting - see an example of an app on the picture below:

<ImageBorder variant="blue">![Screenshot 2024-05-03 at 13.56.00.png](https://media.graphassets.com/RnGEydvTmKDP405EsMZk)</ImageBorder>

### Show notebook outputs in app

By default, your app users start with a clean slate, and all block outputs are empty. If you'd like to show the results from the last notebook execution (for example a scheduled run, or something you ran manually), you can enable the setting **Show notebook outputs in app**.

Note, that when your app has multiple input blocks, your users might need to provide a value for each one before the notebook executes without any null values.

When the setting is enabled, the app users will see the values of input blocks and all block outputs currently visible in the notebook.

### Embedding

By embedding your app, you can render it within tools that support it - like Notion, Confluence, or Salesforce, or on your website. You can specify the width and height of the app by using the width and height attributes in the iframe HTML tag. The Deepnote app is responsive and will adjust to fit.

Once your app is embedded, you can parameterize it the same way as a normal app - by adding input values in the URL. The \_\_run parameter can be attached to the URL to make the app run automatically right after it's loaded with the current parameters.

To embed an app, click on the "Embed" button in the Sharing section of App settings.

<ImageBorder variant="blue">![embed-app-settings.png](https://media.graphassets.com/yI96GF5SzO1WvGIUQawl)</ImageBorder>

In the modal window, turn on embedding. Once the setting is enabled, Deepnote will allow the app to be rendered in an iframe, and the preview of the embedded app will render on the left side of the modal.

<ImageBorder variant="colorful">![embed-app-modal.png](https://media.graphassets.com/Qd7LB2LiRcSgBuCi5rcI)</ImageBorder>

To embed the app within tools like Notion, Confluence, or Medium, use the **Embed url**. These tools will automatically use the link to render an iframe. If you want to embed your app directly within a website where you have control over the HTML markup, you can use the Embed code link. You can adjust the width and height attributes of the iframe to get the desired size of the app.

#### Embedding apps in Notion

Type `/embed` in a Notion page and paste the embed link into the input. The Deepnote app should appear. You can resize the embedded app to make it look nicer (for example, not collapse columns if it's too narrow).

#### Embedding apps in Confluence

To embed an app in Confluence, use `/iframe` command, and paste the link to **URL** field. We also recommend to set the **frameborder** parameter to "hide", since Deepnote app already renders a frame around itself.

Keep in mind that you can embed individual blocks as well! You can read more about how to do it [here](https://deepnote.com/docs/sharing-and-embedding-blocks).

### App interactivity

The viewers can refresh the app results by clicking the **Run** button in the top-right corner, or by selecting a different value for any of the input blocks. This executes the notebook from top to bottom, or, with the [Reactivity](#reactivity) option turned on and kernel already existing for the session - only the blocks affected by the inputs.

The apps are interactive by default, unless you disable the setting _Allow viewers to run the app_.

#### How does interactivity work?

- Whenever a user interacts with an [Input block](/docs/input-blocks) (e.g. a dropdown menu, a text input) and then clicks on **Apply,** a kernel is created (unless it already exists for the session), and the blocks are executed with the new input values.
- The kernel (which contains the app state) is kept alive for 10 minutes after the last execution, or unless the user closes the browser window for the app. Every run after 10 minutes of inactivity will result in the creation of a new kernel.
- Every run is stateless - users interacting with a published project don't interfere with the project's notebook or app state of other users.
- App runs use the same machines as the project. Execution of the app will wake up the project's machine and use its resources, and the machine will be shut down [after a period of inactivity](/docs/long-running-jobs#how-deepnote-decides-when-to-turn-off-hardware-of-a-project). If you expect a lot of concurrent users in your app, you can upgrade to a stronger machine in your environment settings, and change the project's inactivity settings.
- The app will use the same environment settings (such as custom Docker images) as the underlying project.

<Callout status="info">
If the machine is not running when the app is run, the first execution may take longer due to machine startup time and execution of the initialization notebook.
</Callout>

#### Reactivity

Reactivity can be enabled by turning on "Allow reactivity" settings in App settings. After any input block value is changed and the app is re-run, instead of executing all blocks in the app, only blocks that depend on the values of changed input blocks are executed. This makes app re-runs much quicker, by skipping the blocks that do not influence what the consumer sees in the app.

The analysis of dependencies between blocks is performed by examining the Abstract Syntax Tree (AST) of the Python code in your notebook, also considering the order in which they appear in the notebook. The resulting dependencies can be reviewed by clicking the "Open Dependency Graph" button in the app editor, located directly below the reactivity settings.

<Callout status="info">
Note that reactivity works only if a kernel with the app's state already exists. The first execution of the app, or an execution after 10 minutes of inactivity, will always require running all the blocks.
</Callout>

### Advanced usage

#### Automatically run the app on load

If you add `__run==true` parameter to the app's url, it will run automatically on load. This is especially useful if you want to run an app with inputs in the url automatically. An example of how the app's url with inputs and auto-run could look like:

```
https://deepnote.com/app/your-company/Movie-Recommendation-8dd173b0-d6bc-4212-b1b5-7c89dc0db780/?min_rating=1&max_rating=5&__run=true
```

#### Letting users download files from the project filesystem

A common use case for apps is preparing some results as a CSV file, and letting the end user download it.

When you publish your project as app, you can access the contents of the filesystem using a URL of this format:

```
https://deepnote.com/publish/<project_id>/file?path=<file_path>
```

You can find the `project_id` in the URL, it's in the form of a UUID. The general structure of the URL when editing a notebook is

```
https://deepnote.com/workspace/<workspace_name>-<workspace_id>/project/<project_name>-<project_id>/notebook/<notebook_name>-<notebook_id>
```

You can also find it in an environment variable `DEEPNOTE_PROJECT_ID` if you want to generate it programmatically.

Here's an [example notebook](https://deepnote.com/@deepnote/Download-files-in-app-03df4fac-84e9-45c0-aff6-691016698a7b) demonstrating how to do that.

The access controls of the published app are still respected – only people with access to the app can access the files. Note: all files in the /work directory (what you see in the left sidebar) can be accessed this way, so make sure you are not exposing anything sensitive.

Keep in mind that parallel executions of the app (two users at the same time) could overwrite each other's files. If that is a concern, consider generating unique filenames at execution time, and printing the generated URL for each user.

_Watch it all come together in this 1-minute demo:_

<Embed url='https://www.loom.com/share/4f7f5397f7a3481189102f3743f9afdf?hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true' />

### Deleting apps

You can delete an app at any time by going to _App settings_ and selecting **Delete app**.
