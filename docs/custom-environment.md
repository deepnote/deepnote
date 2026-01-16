---
title: Custom environments
noIndex: false
noContent: false
---

If [default environments](https://deepnote.com/docs/default-environment) don't meet your project's requirements, you can create **custom environments** in Deepnote. These can be either imported into your project or defined directly in Deepnote itself.

## How does it work?

At its core, each project's runtime environment is a **Docker image**, giving you extensive customization options. Anything you can define in a Dockerfile can be implemented in your Deepnote project. This is particularly powerful for:

- Building libraries from source with specific versions
- Installing custom binary dependencies
- Managing Python packages through requirements.txt

Custom environments are especially valuable for complex projects where dependency installation is time-consuming and needs to be reused across multiple notebooks.

## Requirements

We recommend building your custom Dockerfile on top of our `deepnote:python3.x` base image to ensure compatibility with all Deepnote features. If you're creating an environment from scratch, your image must meet these requirements:

- Python (versions 3.10-3.13) installed and accessible via the `python` command
- Built for the `linux/amd64` platform (M1 Mac users: use `-platform linux/amd64` flag)
- Functioning `pip` installation that can install packages to Python's path
- `bash` and `curl` installed

### Package Installation

All pip installations must use our constraints file:

```bash

pip install tensorflow -c https://tk.deepnote.com/constraints<PYTHON_VERSION>.txt

```

This constraints file helps prevent library conflicts and ensures compatibility with Deepnote's features like the variable explorer and interactive DataFrame views. Don't worry about installing additional dependencies for these features—we'll automatically detect and load them at runtime.

## How to create a custom environment?

### Local Dockerfile

<aside>
Building a local Dockerfile in Deepnote is a premium feature available only on **Team** and **Enterprise** plans.
</aside>

You can customize your environment by placing a `Dockerfile` in your project's root directory. Deepnote handles all the image building and hosting for you.

The most common approach is to extend one of our default environments. For example, here's how to add [OpenCV](https://opencv.org/) dependencies to our Python 3.11 base image:

```
FROM deepnote/python:3.11

RUN apt update && apt install -y ffmpeg libsm6 libxext6

```

To use your local Dockerfile, simply select **Dockerfile** from the Environment dropdown.

![CleanShot 2024-11-28 at 10.00.45.png](https://media.graphassets.com/CzaaCxT1QO5mqxUtXavA)

When building from a local Dockerfile, only the following Docker instructions are supported:

- **FROM**: Start with any public base image or [Deepnote environment](https://hub.docker.com/u/deepnote)
- **RUN**: Execute commands as root to install libraries and tools
- **ENV**: Set environment variables or define default Jupyter kernels

Local Dockerfile builds are available on **Team** and **Enterprise** plans with the following constraints:

- Maximum build time: 60 minutes
- For longer builds, we recommend building outside of Deepnote (see below)

### Hosted docker image

**Public images**

You can use any publicly available Docker image from repositories like [Docker Hub](https://hub.docker.com/), giving you access to thousands of pre-configured environments.

**Private Repositories**

**Team** and **Enterprise** users can connect to private image repositories from:

- [Docker Hub](https://www.notion.so/docs/docker-hub)
- [Google Container Registry](https://www.notion.so/docs/google-container-registry)
- [Amazon ECR](https://www.notion.so/docs/amazon-ecr)

To use private repositories:

1. Create an integration with your repository provider
2. Add your credentials
3. Connect the integration to projects where you need your private images

![CleanShot 2024-11-28 at 10.14.03.png](https://media.graphassets.com/m8a18CpYRaCyRNQEF0bk)

## Keep environment settings

When you duplicate a project, all environment configurations come with it - saving you from setting everything up again.
Note: This doesn't apply when duplicating to a different workspace. In that case, you'll need to reconfigure your environment.

Pro tip: Need the same environment across many projects? Create a [project template](https://deepnote.com/docs/projects#project-templates) - it's the most efficient way to standardize your setup.
