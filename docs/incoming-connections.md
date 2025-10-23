---
title: Incoming connections
noIndex: false
noContent: false
---

Many tools, such as [Tensorboard](https://www.tensorflow.org/tensorboard) and [Streamlit](https://streamlit.io/), require a local webserver to be spun up to serve docs, dashboards, and other web interfaces. They often prompt you to open an address like `http://localhost:8080)`.

When you enable incoming connections, Deepnote exposes port `8080` on the internet under an address such as `b9d13315-f12a-4931-857c-ed6b4c59dcad.deepnoteproject.com`. You can use this address to access services running on port `8080` on your Deepnote machine.

<Callout status="warning">
Enabling incoming connections means that anyone on the internet will be able to access port 8080 on your machine.
</Callout>

### How to allow incoming connections

Incoming connections require two levels of configuration:

#### 1. Enable incoming connections for the workspace

Workspace admins must first enable incoming connections at the workspace level. This allows individual projects within the workspace to use this feature.

To enable incoming connections for your workspace:

1. Navigate to **Settings & Members** in the left sidebar
2. Go to the **Project settings** tab
3. Toggle on **Allow incoming connections in projects**

When this setting is disabled, projects in the workspace cannot enable incoming connections.

![allow_incoming_connections.png](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cmgkm0057gktn07myz749i9ng)

#### 2. Turn on incoming connections for individual projects

Once incoming connections are enabled at the workspace level, you can turn them on for specific projects:

1. Open the project where you want to enable incoming connections
2. In the left sidebar, click on the **More options** button next to **Start machine**.

3. Toggle on **Incoming connections**.

![project_incoming_connections.png](https://us-west-2.graphassets.com/AaDC4FvhQQq2MDrtSUqtMz/cmgkm0055ga3307n4i9v6jyn0)

If you want to try it out, paste `!python -m http.server 8080` into a block and run it. If incoming connections have been enabled as described above, you should be able to paste the provided link into a browser to connect to the running webserver.

### What if I need to expose a different port?

Right now we only support exposing port 8080. To expose other ports, you can either reconfigure your tool, or use utilities like `socat` which can forward traffic from port `8080` to the port of your choosing. You can use the example below to set up port forwarding with `socat` in the terminal:

```
apt update && apt install socat
socat tcp-l:8080,fork,reuseaddr tcp:127.0.0.1:YOUR_PORT
```

### Running Flask

You can also use Deepnote to prototype a simple Flask server. When using its development server, don't forget to set the `host` to reach it from outside the local machine.

Example:

```python
from flask import Flask

app = Flask(__name__)

@app.route("/")
def hello_world():
    return "<p>Hello, World!</p>"

app.run(host='0.0.0.0', port=8080)
```
