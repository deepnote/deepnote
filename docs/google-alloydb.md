---
title: Google AlloyDB
description: Available to teams and users on all plans
noIndex: false
noContent: false
coverImage: 3xnSUUp0TCOjG316hDwf
---

Deepnote can interact with your Google AlloyDB instances. Follow these docs to create your own notebook that connects to your Google AlloyDB instance.

Prerequisites are that that you have [setup an Google AlloyDB instance](https://cloud.google.com/alloydb/docs/instance-primary-create), and you have [created a Compute VM instance](https://cloud.google.com/compute/docs/instances/create-start-instance) that you can access your Google AlloyDB instance from.

### 1. Getting set up

You will need a notebook and terminal open. We will use the terminal to create an SSH tunnel between Deepnote project and the VM instance.

### 2. Set up SSH keys

**Create your SSH key**

In your Deepnote Terminal, create an SSH key. Your user name must match the username in the Compute VM instance.

```
mkdir ./.ssh
ssh-keygen -t rsa -f ./.ssh/[key_name_here] -C [user_name_here]
cd .ssh
chmod 400 [key_name_here]
cat [key_name_here].pub
```

**Add your SSH key to your VM Compute instance**

Copy the resulting key, and paste it into Google Cloud -> VM Instances -> [INSTANCE_NAME] -> SETTINGS -> METADATA -> SSH KEYS

### 3. Connect to your Compute VM Instance and start the Auth Proxy

Connect to your Compute VM Instance

```
ssh -i ./[key_name_here] [user_name_here]@[vm_instance_external_ip_here]
```

On your compute VM, you now need to run your [AlloyDB Auth Proxy](https://cloud.google.com/alloydb/docs/auth-proxy/connect), that will allow you to connect to your AlloyDB instance. Follow the instructions listed. After installing and Authenticating the Auth Proxy, you can run it using:

```
./alloydb-auth-proxy projects/[project_id_here]/locations/[region_id_here]/clusters/[cluster_id_here]/instances/[instance_id_here]
```

### 4. Create your SSH tunnel

In another terminal session, create the SSH tunnel using the keys we created and whitelisted before.

```
ssh -L 127.0.0.1:9999:127.0.0.1:5432 -i ./.ssh/[key_name_here] [user_name_here]@[vm_instance_external_ip_here]
```

### 5. Connect to the Google AlloyDB instance from your Notebook

Now that your SSH tunnel is running, you may simply add our built in AlloyDB integration. FIll out the host and port of your SSH tunnel, and the database information of your Google AlloyDB instance. Viola, you may now query with Deepnote's SQL blocks.

![Screenshot 2023-06-14 at 15.33.50.png](https://media.graphassets.com/WjsF3LoREKCCvYVGhTrh)

### What's next?

This is a new integration, and we are still working out some kinks.
We are working on reducing the SSH connection steps, and implementing our schema browser for Google AlloyDB.

But for now query away!

Now that you're querying data, you can share it with your team. You can even turn your charts [into a shareable dashboard](/docs/publish-projects).
