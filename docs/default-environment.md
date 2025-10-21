---
title: Default environments
noIndex: false
noContent: false
---

Deepnote offers a variety of preconfigured environments, all maintained by our engineering team and ready to use out of the box. These environments are primarily built on Debian Linux and the official Python repository, with Python being our primary supported language. While you can also use other languages like R or Stata, these environments have limited functionality and don't support all Deepnote features.

Default environments launch in seconds thanks to pre-warmed instances and cached images. These environments are battle-tested, used by the majority of Deepnote projects, and come with comprehensive support from our team. They include all common binary dependencies pre-installed, minimizing potential setup issues and helping you get started faster.

Our engineering team regularly updates the default environments to ensure all system components stay current, including Linux security patches and binary dependencies. However, if your project requires specific versions of system binaries or kernels, we recommend using a [custom environment](https://deepnote.com/docs/custom-environment) to maintain consistent behavior and prevent potential compatibility issues.

![CleanShot 2024-11-28 at 09.23.46.png](https://media.graphassets.com/4RENoyheQwa27hZtVDTz)

## Managed environments

| Environment name                   | Image tag                                                                   | Description                                                                                                                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python                             | [deepnote/python:3.x](https://hub.docker.com/r/deepnote/python)             | This lightweight Python environment includes essential binary dependencies while letting you start with a clean slate for Python packages. It's ideal for projects that need a few specific libraries or for building custom environments on top of this. |
| Python with data science libraries | [deepnote/python:3.x-datascience](https://hub.docker.com/r/deepnote/python) | This environment comes pre-loaded with popular data science libraries, offering a ready-to-use workspace for those who want to start coding immediately without package installation.                                                                     |
| Conda                              |                                                                             | This environment comes pre-loaded with popular data science libraries via Conda, offering a ready-to-use workspace for those who prefer Conda package management.                                                                                         |
| Tensorflow GPU                     |                                                                             | This environment comes with TensorFlow configured for GPU acceleration, offering a ready-to-use workspace for deep learning projects that require high-performance computing.                                                                             |
| R                                  | [deepnote/ir:x](https://hub.docker.com/r/deepnote/ir)                       | This experimental environment enables R programming within Deepnote notebooks.                                                                                                                                                                            |
| R with data science libraries      | [deepnote/ir-with-libs:x](https://hub.docker.com/r/deepnote/ir-with-libs)   | This environment comes with popular R data science libraries pre-installed.                                                                                                                                                                               |

Need something more specific? You can create [custom environments](https://deepnote.com/docs/custom-environment) tailored to your project's needs. Build your own environment with exactly the dependencies you require, then share it across your entire workspace for consistent development.
