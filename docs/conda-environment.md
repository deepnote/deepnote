---
title: Conda environment
noIndex: false
noContent: false
---

[Anaconda Inc.](https://www.anaconda.com/) maintains a repository of thousands of curated packages for data science.

Deepnote comes with a pre-built conda environment which allows users to instantly take advantage of the Anaconda ecosystem. This includes being able to use conda—a widely used CLI tool for package management which will include packages from the [Miniconda Installer](https://docs.conda.io/en/latest/miniconda.html).

## How to use the conda environment Deepnote

Simply select "Anaconda - Python 3.9" from Deepnote's environment dropdown (as shown below). You now have access to the pre-installed packages listed below as well the conda CLI.

![conda.gif](https://media.graphassets.com/Oyygz8pnS7K7ibNWoyZA)

### Installing packages from the Anaconda repository

Use the conda CLI from within the notebook to install packages. For example, to install Altair, type the following into a code block:

```python
!conda install altair
```

See this [template notebook](https://deepnote.com/workspace/deepnote-8b0ebf6d-5672-4a8b-a488-2dd220383dd3/project/Anaconda-Template-Weather-a2c95362-b4c4-4f22-8bc9-0b0f12ee5c34) for an example.

### Listing the installed packages in the conda environment

To list the currently installed packages, type the following into a code block:

```python
!conda list
```

### How does a `requirements.txt` file work with the conda environment?

Upon startup, Deepnote will install any packages listed in a `requirements.txt` file; however, currently `pip` will be used to install packages into the conda environment in this case.

### Which packages are pre-installed in the miniconda environment?

Here is a list of packages that are pre-installed when using the initial conda environment (as described above, you can use `!conda install <package name>` to install additional packages):

- \_libgcc_mutex
- \_openmp_mutex
- altair
- attrs
- brotlipy
- ca-certificates
- certifi
- cffi
- charset-normalizer
- colorama
- conda
- conda-content-trust
- conda-package-handling
- cryptography
- entrypoints
- idna
- jinja2
- jsonschema
- ld_impl_linux-64
- libffi
- libgcc-ng
- libgomp
- libstdcxx-ng
- markupsafe
- ncurses
- numpy
- openssl
- pandas
- pip
- pyarrow
- pycosat
- pycparser
- pyopenssl
- pyrsistent
- pysocks
- python
- python-dateutil
- pytz
- readline
- requests
- ruamel_yaml
- setuptools
- six
- sqlite
- tk
- toolz
- tqdm
- tzdata
- urllib3
- wheel
- xz
- yaml
- zlib
