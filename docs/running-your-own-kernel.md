---
title: Running your own kernel
noIndex: false
noContent: false
---

If you need to work with different language then Python, the Jupyter ecosystem provides you with a vast selection of other kernels. You can now run them in Deepnote!

<Callout status="warning">
**Deepnote's support for other kernels is still in its early days.**

Some features don't work yet. This includes including the variable explorer, SQL cells, input cells, and autocomplete.
</Callout>

<Callout status="info">
Deepnote uses the environment variable `DEFAULT_KERNEL_NAME` that you set in the Dockerfile and uses it to create new notebooks with that kernel.
</Callout>

The best way to run a custom kernel is to find an existing image, for example on [Dockerhub](https://hub.docker.com/search?q=jupyter&type=image), and then set the environment variable `DEFAULT_KERNEL_NAME`. To override the default kernel, you must modify the metadata in the .ipynb file. An alternative method is to install the kernel into the default Deepnote image, see examples below.

## R kernel

In the right sidebar, pick your preferred version of R from the dropdown in the environment section. We recommended choosing the `deepnote/ir_with_libs` image. This will install R 4.2 and many common data science libraries for you (see the image details [here](https://hub.docker.com/r/deepnote/ir-with-libs)).

### Installing R packages

#### In the default R environments

You can simply use the `install.packages` and `library` commands the way you normally would.

R packages often take a long time to install. We install them to your `work` folder by setting your environment variable `R_LIBS_USER="~/work/.R/library"`, so they stay there during hardware restarts.

#### In your custom environment

If you're comfortable using your own Docker image, the preferred way would be to install the packages at build time, or pick from the large selection on Dockerhub.

## Julia kernel

Use custom Dockerfile in the environment tab, and build an image with the following code:

```bash
FROM deepnote/python:3.7

RUN wget https://julialang-s3.julialang.org/bin/linux/x64/1.6/julia-1.6.2-linux-x86_64.tar.gz && \
    tar -xvzf julia-1.6.2-linux-x86_64.tar.gz && \
    mv julia-1.6.2 /usr/lib/ && \
    ln -s /usr/lib/julia-1.6.2/bin/julia /usr/bin/julia && \
    rm julia-1.6.2-linux-x86_64.tar.gz && \
    julia  -e "using Pkg;pkg\"add IJulia\""

ENV DEFAULT_KERNEL_NAME "julia-1.6"
```

## Bash kernel

Use custom Dockerfile in the environment tab, and build an image with the following code:

```bash
FROM deepnote/python:3.7

RUN pip install --no-cache-dir notebook bash_kernel && \
  python -m bash_kernel.install
ENV DEFAULT_KERNEL_NAME "bash"
```

## Scala 2.12 kernel (Almond 0.13.2)

Use a custom Dockerfile in the environment tab, and build an image with the following code:

```bash
FROM almondsh/almond:latest

ENV DEFAULT_KERNEL_NAME "scala212"
```

## Racket kernel

Use custom Dockerfile in the environment tab, and build an image with the following code:

```bash
FROM deepnote/python:3.7

# The following snippet is licensed under MIT license
# SEE: https://github.com/jackfirth/racket-docker

RUN apt-get update && \
    apt-get install -y libzmq5 && \
    pip install --no-cache-dir notebook && \
    apt-get purge -y --auto-remove && \
    rm -rf /var/lib/apt/lists/*

ENV RACKET_INSTALLER_URL=http://mirror.racket-lang.org/installers/7.8/racket-7.8-x86_64-linux-natipkg.sh
ENV RACKET_VERSION=7.8

RUN wget --output-document=racket-install.sh -q ${RACKET_INSTALLER_URL} && \
    echo "yes\n1\n" | sh racket-install.sh --create-dir --unix-style --dest /usr/ && \
    rm racket-install.sh

ENV SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"
ENV SSL_CERT_DIR="/etc/ssl/certs"

RUN raco setup && \
  raco pkg config --set catalogs \
    "https://download.racket-lang.org/releases/${RACKET_VERSION}/catalog/" \
    "https://pkg-build.racket-lang.org/server/built/catalog/" \
    "https://pkgs.racket-lang.org" \
    "https://planet-compats.racket-lang.org" && \
  raco pkg install --auto iracket && \
  raco iracket install

ENV DEFAULT_KERNEL_NAME "racket"
```

Thanks, [@dkvasnickajr](https://twitter.com/dkvasnickajr/status/1321901316411711490?s=20) for [sharing this](https://gist.github.com/dkvasnicka/9e7f5c516e997d3f3f00b0256755b906)!

You can [clone this project from Deepnote](https://deepnote.com/project/ead07c75-5f57-49c3-b2a9-3b1b62bd5c59#%2Fnotebook.ipynb).

## Ruby

Use custom Dockerfile in the environment tab, and build an image with the following code:

```bash
FROM deepnote/python:3.7

RUN apt-get update -qq && \
  apt-get install -y --no-install-recommends \
    libtool libffi-dev libzmq3-dev libczmq-dev \
    make ruby-full && \
  gem install ffi-rzmq && \
  gem install iruby --pre && \
  apt-get purge -y --auto-remove && \
  rm -rf /var/lib/apt/lists/*

ENV DEFAULT_KERNEL_NAME=ruby
```

Then replace the content of your 'Init' notebook with following:

```bash
!iruby register --force
```

After resetting the project state, you should be able to use Ruby in your notebooks.

### Ruby On Rails

We have[ published a tutorial](https://deepnote.com/@deepnote/Ruby-on-Rails-in-Deepnote-QF-mn5foT7y3lfI_ItXf7g) to help your run an existing Ruby on Rails project in Deepnote. One of the use cases is querying your data based on the existing ActiveRecord models, theirs scopes and relations.

##
