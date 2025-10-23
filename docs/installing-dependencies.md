---
title: Installing dependencies
noIndex: false
noContent: false
---

There are 3 major ways of installing system-level dependencies and Python packages in Deepnote:

- installing them ad-hoc in your notebook;
- using an initialization script (Init notebook);
- or by changing the underlying environment image.

### 1. Installing new packages via ad-hoc installation (pip or apt)

Simply run `pip install <package_name>` or `apt install <library>`, either in the terminal or with the `!` prefix in a notebook.

![CleanShot 2024-11-28 at 09.10.08.png](https://media.graphassets.com/YxhpDdlTSCF37EZzcZTQ)

If you are in a [conda environment](https://deepnote.com/docs/conda-environment), you can also run `conda install <package_name>`.

This will immediately install the library for you to use.

Note that when the hardware restarts, the environment will revert back to the default state.

### Installing packages through a proxy

If you have packages pulled from a custom registry which needs to have an IP allowlisted, Deepnote can route your pip download through a proxy. Simply add the `proxy` argument with our IP `http://34.68.180.189:3128/` to the pip install.

```
pip install -r requirements.txt --extra-index-url=http://something.com --proxy <http://34.68.180.189:3128>

```

### 2. Initialization script (Init notebook)

Deepnote provides an optional feature to run custom Python initialization code every time your project hardware boots up. To utilize this capability, you will need to **include an 'Init' notebook** in your project.

To create an 'Init' notebook:

Navigate to your project's **Machine** section in the project sidebar.

- Click on the environment selection menu.
- Click on the **Create initialization notebook** button.

![CleanShot 2024-11-28 at 08.58.46.png](https://media.graphassets.com/JFHU4qtsSdCDWINAo66C)

After creating it, the 'Init' notebook will be conveniently located at the top of your Notebook list. The contents of this notebook will automatically execute each time your project starts up, providing an ideal place to set up your preferred environment.

By default, the 'Init' notebook installs any packages listed in **./requirements.txt**. However, you are free to customize this according to your project's needs.

For a more detailed explanation of project initialization, follow this [link](https://deepnote.com/docs/project-initialization).

### 3. Environments

Deepnote environments are customizable runtime configurations powered by **Docker images**. Each environment defines the complete stack - from the Linux operating system to Python packages and binary dependencies.

While Deepnote provides several pre-configured environments for common use cases, you can also create your own custom environment using any Docker image, giving you full control over your runtime setup.

Read more about [default](https://deepnote.com/docs/default-environment) and [custom](https://deepnote.com/docs/custom-environment) environments.
