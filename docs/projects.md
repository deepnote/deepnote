---
title: Projects
description: You have a very specific task that requires a coding environment, notebooks, and data. That's where projects come in — a collaborative container for everything you need to complete your analysis.
noIndex: false
noContent: false
---

## What can you do with projects?

Projects do a lot, from shared data sources across multiple notebooks to native version control. Here are some highlights:

- Projects contain notebooks and therefore can be used to organize related work (e.g., EDA notebook, ML notebook)
- Projects define your environment — including the Python version, required libraries, and the machine specifications (i.e., RAM, number of cores).
- Projects have their own file system and provide access to database integrations.

### Creating a project

From the left panel in your Workspace, you can click the **"+"** symbol next to **PROJECTS** to create a new project, either from scratch or from Deepnote's built-in templates. In addition, clicking on the ellipses beside a project will provide options for creating, duplicating, and moving projects (and more).

Don't forget that you can arrange your projects into folders here, too. Just drag and drop them to suit how you like to organize your work.

![Create_Project.jpg](https://media.graphassets.com/VScQrWGQxSKL5wCylTxH)
<br></br><br></br>

Let's move to the newly created Project panel now. Notice that the left panel has changed and you are focused on the context of your Project.

### Learning the most important bits

The Project sidebar on the left contains sections for your notebooks, integrations, files, the environment, terminals, and more. Let's learn about each of these in detail.

![Important Bits.jpg](https://media.graphassets.com/h9lkwiibTeSNaquQx2If)
<br></br><br></br>

#### Notebooks

The **Notebooks** section can contain multiple notebooks. This is helpful since multiple notebooks are often needed to accomplish an overall goal. Read more about Deepnote's powerful notebooks [here](https://deepnote.com/docs/notebooks).

#### Integrations

The **Integrations** section is all about hooking up resources to your project. It's where you connect to [databases/warehouses](https://deepnote.com/docs/snowflake), [buckets](https://deepnote.com/docs/amazon-s3), [Docker container registries](https://deepnote.com/docs/amazon-ecr), and [secrets](https://deepnote.com/docs/environment-variables). Your collaborators can share these connections without having to bother with additional setup.

#### Files

Think of this section as your local computer's file system. It's snappy like that. Drag a CSV into it or upload the other scripts and files you need. The file system is a shared space for all notebooks within a single project. To learn more about working with the file system, read our general guidelines [here](https://deepnote.com/docs/importing-data-to-deepnote).

<Callout status="success">

Got a `requirements.txt` file? We create one for you when you `pip` install a package. And we automatically install the listed packages every time your machine starts up.

</Callout>

#### Environment

Time to get serious. You probably want to know how to configure your environment. Let's dive into what you can do in the **Environment** section.

First, click on the ⚙️ icon. You should now see your environment configuration options (shown below). Follow me.

![Environment.jpg](https://media.graphassets.com/PSMiDJAtRlFgQrhOIsVA)

**Machine:** If you need a "beefier" machine, this is where you can choose one. If you're on a Team or Enterprise plan, you get unlimited hours on a 16GB, 4vCPU machine. To learn more about machines in Deepnote, click [here](https://deepnote.com/docs/machine-hours).

**Built-in environments:** From the dropdown menu (under **Environment**) you can choose between any of the built-in Python environments. They come [pre-installed with the most popular libraries](https://deepnote.com/docs/pre-installed-packages) so you can begin working immediately. The default environment is Python 3.9.

<Callout status="info">

🔥 If the built-in environments don't meet your needs, no problem. You may **define a local Dockerfile** or bring your own image from any registry (e.g., ECR, Docker Hub, etc.). To learn more about custom environments, [hop over here](https://deepnote.com/docs/custom-environments).

</Callout>

**Initialization notebook:** There are times when you want to run some "starter" code before your notebook is used. You can place such code in a notebook called 'Init'. Read more about setting up custom [project initialization](https://deepnote.com/docs/project-initialization).

**Incoming connections:** Toggle this switch if you need to [spin up a web server from Deepnote](https://deepnote.com/docs/incoming-connections). Yes, this is perfect for hosting the Airflow console, Streamlit apps, TensorBoard, and much more.

#### Terminals

We all need a CLI every now and then, even if we are notebook lovers. Well, you can create as many terminals as you like in the **Terminal** section. Read more about terminals [here](https://deepnote.com/docs/terminal).

### Project templates

In case you'll find yourself attaching the same integrations, or using the same environment in most of your projects, you can save the project as a template. To do that, click on the dropdown option of your project, and click "Add to templates".

<Callout status="info">

Under the hood, a project template is just a special type of project - this means that you can edit and execute notebooks in it. Once you convert a project to a template, you won't find it in the workspace sidebar anymore, but in the "New project from template" modal.

</Callout>

## Going deeper with projects

Projects can do so much more. We encourage you to check out how to use [comments](https://deepnote.com/docs/comments), how to [version projects](https://deepnote.com/docs/history) and view their history, and how to [connect to GitHub](https://deepnote.com/docs/github).
