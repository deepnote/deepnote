---
title: Amazon Elastic Container Registry
description: Do you have a private Docker image on Amazon ECR that you want to use in Deepnote? No problem. Follow these steps use your custom environment.
noIndex: false
noContent: false
---

<Callout status="info">
Available on the Enterprise plan
</Callout>

With Amazon ECR, you can run notebooks in your own custom environments using Docker containers.

## How to connect to Amazon ECR

To add a connection to ECR in Deepnote, go to **Integrations** in the **left-hand sidebar** and create a new Amazon ECR integration.

You will need the **Account ID** and the **Region** where your registry is located. You will also need an **Access key** and **Secret key** for an [IAM user](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html) with the following permissions:

- ecr:BatchGetImage
- ecr:GetDownloadUrlForLayer
- ecr:GetAuthorizationToken

You can set the [policies on the registry level](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.html) instead to limit access to specific repositories.

### Authenticating using an IAM role

Using an IAM role instead of a username and password to connect to your ECR is preferred for enhanced security and easier management. IAM roles offer temporary credentials that automatically rotate, reducing the risk of long-term credential exposure. This approach also simplifies permissions management, allowing for more granular access control to ECR images based on the principle of least privilege. Moreover, it eliminates the need to store static credentials, reducing the potential for security breaches.

Select the IAM role option in the "Authentication" section in the dropdown menu.

Enter the Amazon Resource Name (ARN) of the AWS role you wish to use for this integration. This role should be configured with the necessary permissions to access ECR and download images. For example, you can assign the policy named `AmazonEC2ContainerRegistryReadOnly`.

To allow Deepnote to access your ECR, you must update the role's trust policy. Copy the generated trust policy and update your role's trust relationship in the AWS IAM console.

## How to use Amazon ECR in Deepnote

After creating and connecting the integration, you can create a [custom environment](/docs/custom-environment) based on one of your Docker images.

Click the Environment dropdown in the Machine section in the left-hand sidebar to bring up the Environment selection modal. Click on "Set up a new Docker image," enter the URL for the image you want to use, and give it a name. Clicking "Add environment and apply" will restart your machine using your Docker image.

<Callout status="info">
**Your credentials are encrypted and securely stored in our database.** When you delete this integration, we also wipe your ECR credentials from our systems.
</Callout>
