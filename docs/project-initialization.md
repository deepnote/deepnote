---
title: Project initialization
noIndex: false
noContent: false
---

Deepnote provides an optional feature to run custom Python initialization code every time your project hardware boots up. To utilize this capability, you will need to **include an 'Init' notebook** in your project.

To create an 'Init' notebook:

- Click on the **Environment** selector in the project sidebar.
- Click on the **Create an initialization notebook** button at the **Custom initialization** section on the right.

![create init notebook.png](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cme9ngrjydvfw07mx6gnvdyam)

Alternatively, you can also simply create a new notebook by pressing the plus button in your Notebook list and name it as 'Init'.

After creating it, the 'Init' notebook will be conveniently located at the top of your Notebook list.

![init notebook.png](https://media.graphassets.com/fjaNIAvXSq17LnRqHvlW)

The contents of this notebook will automatically execute each time your project starts up, providing an ideal place to set up your preferred environment.

Please note: the 'Init' notebook will only act as an initialization notebook if it's called '**Init**' and it is marked by the configuration notebook symbol (lightning icon). For instance, if you create a notebook called 'init', that won't be automatically run at project startup.

By default, the 'Init' notebook installs any packages listed in ./requirements.txt. This provides a convenient option to ensure you have all package dependencies ready. However, you are free to add any other code into the 'Init' notebook according to your project's needs.

<Callout status="warning">

**There are 2 packages on the disallowlist:** `jupyter` and `jedi`. These are packages that interfere with the way Deepnote works and their installation would break your environment. In the 'Init' notebook , we scan the requirements files for those packages and skip their installation if they are there.

</Callout>
