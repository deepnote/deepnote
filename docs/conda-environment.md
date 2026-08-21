---
title: Conda environment
noIndex: false
noContent: false
---

[Anaconda Inc.](https://www.anaconda.com/) maintains a repository of thousands of curated packages for data science.

Deepnote comes with a pre-built conda environment which allows users to instantly take advantage of the Anaconda ecosystem. This includes being able to use conda—a widely used CLI tool for package management which will include packages from the [Miniconda Installer](https://docs.conda.io/en/latest/miniconda.html).

## How to use the conda environment Deepnote

Simply select "Anaconda - Python 3.13" from Deepnote's environment dropdown (as shown below). You now have access to the pre-installed packages listed below as well as the conda CLI.

<VideoLoop src="../assets/docs/environment/conda-environment.webm" />

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

### Which packages are pre-installed in the Anaconda Python 3.13 environment?

Here is a list of packages that are pre-installed when using the initial conda environment (as described above, you can use `!conda install <package name>` to install additional packages):

<!-- cspell:disable -->

- \_libgcc_mutex
- \_openmp_mutex
- anaconda-anon-usage
- anaconda-auth
- anaconda-cli-base
- annotated-types
- anyio
- archspec
- boltons
- brotlicffi
- bzip2
- c-ares
- ca-certificates
- certifi
- cffi
- charset-normalizer
- click
- conda
- conda-anaconda-telemetry
- conda-anaconda-tos
- conda-content-trust
- conda-libmamba-solver
- conda-package-handling
- conda-package-streaming
- cpp-expected
- cryptography
- dbus
- distro
- expat
- fmt
- frozendict
- gettext
- gettext-tools
- h11
- httpcore
- httpx
- icu
- idna
- jansson
- jaraco.classes
- jaraco.context
- jaraco.functools
- jeepney
- jsonpatch
- jsonpointer
- keyring
- ld_impl_linux-64
- libarchive
- libasprintf
- libasprintf-devel
- libbrotlicommon
- libbrotlidec
- libbrotlienc
- libcurl
- libev
- libexpat
- libffi
- libgcc
- libgcc-ng
- libgettextpo
- libgettextpo-devel
- libgomp
- libiconv
- libidn2
- libkrb5
- libmamba
- libmambapy
- libmpdec
- libnghttp2
- libsolv
- libssh2
- libstdcxx
- libstdcxx-ng
- libunistring
- libuuid
- libxcb
- libxml2
- libzlib
- lmdb
- lz4-c
- markdown-it-py
- mdurl
- menuinst
- more-itertools
- msgpack-python
- ncurses
- nlohmann_json
- openssl
- packaging
- pcre2
- pip
- pkce
- platformdirs
- pluggy
- pthread-stubs
- pybind11-abi
- pycosat
- pycparser
- pydantic
- pydantic-core
- pydantic-settings
- pygments
- pyjwt
- pysocks
- python
- python-dotenv
- python_abi
- readchar
- readline
- reproc
- reproc-cpp
- requests
- rich
- ruamel.yaml
- ruamel.yaml.clib
- secretstorage
- semver
- setuptools
- shellingham
- simdjson
- sqlite
- tk
- tomli
- tomlkit
- tqdm
- truststore
- typer
- typer-slim
- typer-slim-standard
- typing-extensions
- typing-inspection
- typing_extensions
- tzdata
- urllib3
- wheel
- xorg-libx11
- xorg-libxau
- xorg-libxdmcp
- xorg-xorgproto
- xz
- yaml-cpp
- zlib
- zstandard
- zstd
<!-- cspell:enable -->
