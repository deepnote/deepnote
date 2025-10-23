---
title: Workspace permissions
noIndex: false
noContent: false
---

Workspace members can have varying levels of permissions. These permissions apply to all projects within the team's workspace.

To set permissions for team members, open "Settings and Members" in the left sidebar.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FIVquyBrpXfi3v7FzGHXH%2FScreen%20Shot%202022-03-31%20at%204.54.15%20PM.png](https://media.graphassets.com/c5RgzHFSJK8RpcNQxyJw)

### Levels of access

Workspace members can be given the following levels of access:

- **Viewer**:
  - Viewers can see all projects and members of a workspace.
  - They can leave comments on projects but can't make any changes.
  - They can execute all notebooks within the workspace and change input block values.
    Note that Viewers can Duplicate a project to another workspace and request additional access from the team's owner. Custom environments and integrations are not preserved when duplicating a project to another workspace.
- **Editor**: Editors can create and edit workspace projects. Members can also connect or disconnect integrations from projects, but they can't edit or create them.
- **Admin:** Admins have all access rights. In addition, they have permission to manage workspace members and integrations.

Additionally, users who do not have a role in the workspace, but are invited to individual projects will show up as **Guests**.

### User groups

<Callout status="info">This feature is available on the **Enterprise** plan.</Callout>

To simplify sharing projects with multiple users at the same time (for example, within the same department), you can organize workspace members into groups. To create and manage groups, navigate to **Settings & Members > Groups**. There are no restrictions on how many groups you can create.

<ImageBorder variant="blue">![Screenshot 2025-02-10 at 17.12.10.png](https://media.graphassets.com/7YiaaQKIR8S7t14g7sVg)</ImageBorder>

You can share a project with a user group in the Sharing popover.

<ImageBorder variant="blue">![groups-project-sharing.png](https://media.graphassets.com/ofCUNx6SSMqEPFKyOPXS)</ImageBorder>

### Domain invites

Enabling domain invites will allow every user with a matching email domain to join the workspace as a Viewer. Users can join the workspace during sign-up or later from the workspace switching menu.

Workspace Admins can enable domain invites. The only permitted domain is the email domain of the Admin (Owner) – the person who created the workspace.

The option will not show up for workspaces where the domain is from a public email service (such as @gmail.com or @outlook.com) or for educational addresses.

If you need help changing the Owner's email or setting up a different Owner, please reach out to support.

![domain-invites.png](https://media.graphassets.com/xSw2tP5T8GaZNqTVbsVN)

### Enforced SSO provider

In the workspace settings, Admins can turn on a setting that enforces the login provider for the entire workspace. This ensures that no personal accounts or accounts from outside your organization can access your Deepnote workspace.

This setting does not apply to project-specific individual sharing settings. Individual projects can still be shared with external users, who will appear on the members page as Guests.

When the setting is disabled, it will offer Admins the SSO provider they are currently using to log in. To enforce a different SSO provider, sign out and sign back in using that SSO provider first.

![Enforce SSO provider.png](https://media.graphassets.com/YET0c7BERhSzPFRlXF3b)

### FAQ

_How do I prevent certain members from seeing one of the workspace projects?_

To share a project only with certain workspace members, change the project access from _Full access_ to _No access_. This will make the project only visible to you. It will show up in your workspace as a Private project. If you would like certain workspace members to have access, you can add them as project collaborators.

Private projects still have access to the workspace resources, such as integrations and machine hours. Note that only **Editors** and **Admins** can create private projects.

_How can I lock a project?_

From within a project, you can set the workspace member permissions to **View** in "one fell swoop". Note that **Admins** will always be able to edit projects. If the option is set to "Full access" then all members of a workspace will follow their respective roles according to the **Workspace** settings.

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2F8tQwVGDySVsBRdGxxgnK%2Fread.gif](https://media.graphassets.com/jSLTgSiyT82Rlbi01ftl)
![domain-invites.png](https://media.graphassets.com/xSw2tP5T8GaZNqTVbsVN)
