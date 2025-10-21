---
title: Python requirements
noIndex: false
noContent: false
---

### Installing packages through pip

If you install (or uninstall) a package thorough the `!pip` command in a notebook, a suggestion will show up to move that package to `requirements.txt`.

### requirements.txt

If your project contains a `requirements.txt` file in the root of the filesystem, Deepnote automatically installs those requirements when the hardware starts, using the [`init.ipynb`](/docs/project-initialization) notebook. If you manually edit the `requirements.txt`, you will need to run `pip install -r requirements.txt`, either in a notebook or in a terminal.

### Unsupported packages

Some packages are not fully supported yet. If you have problems with a package, please reach out through the support chat in the application.

### Installing packages through a proxy

If you have packages pulled from a custom registry which needs to have an IP allowlisted, Deepnote can route your pip download through a proxy. Simply add the `proxy` argument with our IP `http://34.68.180.189:3128/` to the pip install.

```
pip install -r requirements.txt --extra-index-url=http://something.com --proxy http://34.68.180.189:3128
```
