---
title: Deploying machine learning models
noIndex: false
noContent: false
---

Deepnote provides an environment for training machine learning models similar to a standard Jupyter notebook or any local Python setup. It offers secure integration with third-party services like Comet.ml or Weights and Biases, enabling you to adhere to best practices throughout the model development lifecycle. For more details, refer to the section on [Training machine learning models in Deepnote](https://deepnote.com/docs/training-machine-learning-models).

## Model deployment options

Once your model is trained and optimized, Deepnote offers various deployment options, allowing you to seamlessly move from data preprocessing to production deployment within the same platform. Here are some deployment methods supported by Deepnote:

- **Directly from Deepnote**: The simplest way to host your model is to create a dedicated notebook that loads your trained model and runs inference against desired input values. Read more on this below.
- **Cloud storage**: Save your model to cloud storage services like [Amazon S3](/docs/amazon-s3), [Google Cloud Storage (GCS)](/docs/google-cloud-storage), or [Google Drive](/docs/google-drive) using Deepnote's native integrations.
- **Docker Containers**: Package your model and its dependencies into a Docker container. You can then deploy this container to repositories such as [DockerHub](https://deepnote.com/docs/docker-hub), [Google Container Registry](https://deepnote.com/docs/google-container-registry) (GCR), or [Amazon Elastic Container Registry](https://deepnote.com/docs/amazon-ecr) (ECR).
- **Hugging Face**: Push your models to the Hugging Face model repository and use Hugging Face Inference Endpoints for hosting deployments.
- **Modelbit**: Create a hosted deployment environment and push models directly from Deepnote to Modelbit. You can also point Modelbit deployment to run on Snowflake. Read more about [deploying ML models to Snowflake with Deepnote & Modelbit](https://deepnote.com/blog/deploy-ml-models-to-snowflake-modelbit) on our blog.
- **Beam**: Use Beam to set up a hosted environment and deploy models directly from Deepnote. [Learn more about packaging models into Bean endpoints](https://docs.beam.cloud/v2/endpoint/invocation).
- **AWS SageMaker**: If your infrastructure is based on AWS, deploy models directly to AWS SageMaker environments, leveraging Deepnote's integration for a streamlined deployment process. Check our our template project for Creating training jobs on [AWS SageMaker from Deepnote](https://deepnote.com/workspace/deepnote-8b0ebf6d-5672-4a8b-a488-2dd220383dd3/project/Training-on-Sagemaker-from-Deepnote-dc3eb58f-8a56-4431-976b-69c87995db96/notebook/66be62fbac9e4577bace85b457c87aa6) and our [example data app](https://deepnote.com/app/deepnote/Sagemaker-training-and-inference-from-Deepnote-dc3eb58f-8a56-4431-976b-69c87995db96) serving inference from a model deployed on Sagemaker.
- **FastAPI**: Use the FastAPI framework to build a backend service around your model. You can then deploy this service using hosting platforms like [Porter](https://docs.porter.run/guides/fastapi/deploy-fastapi), [Coherence](https://docs.withcoherence.com/#fast-api-example), or [Platform.sh](https://github.com/platformsh-templates/fastapi).

These options provide flexibility and ease of use, enabling you to choose the deployment method that best fits your project's needs.

### Serve directly from a notebook

The simplest way to host your model is to create a dedicated notebook that loads your trained model and runs inference against desired [input values](https://deepnote.com/docs/input-blocks). You can even create a [beautiful data app](https://deepnote.com/docs/data-apps), that sits on top of the inference notebook and executes the model with any provided input inside this app. Think of it as a simple dashboard connected to your trained model inside Deepnote which also uses Deepnote hardware to run. These runs are also cached, can be [launched on page load](https://deepnote.com/docs/data-apps#automatically-run-the-app-on-load) and can also be used to [host generated files](https://deepnote.com/docs/data-apps#letting-users-download-files-from-the-project-filesystem) or even whole models.

Check our our example project on [💳 Customer churn modeling](https://deepnote.com/workspace/deepnote-8b0ebf6d-5672-4a8b-a488-2dd220383dd3/project/Customer-churn-modeling-1096d967-46f3-4233-8500-19b888b80b1d/notebook/2.%20Building%20a%20TensorFlow%20model-33c813c0beae4210ab3bdf55fd6e5a50). Notice we have 3 notebooks inside the project

1. [Exploratory data analysis](https://deepnote.com/workspace/deepnote-8b0ebf6d-5672-4a8b-a488-2dd220383dd3/project/Customer-churn-modeling-1096d967-46f3-4233-8500-19b888b80b1d/notebook/1.%20Exploratory%20data%20analysis-40744b0586bc494cb470f45b5e71aa98) - where we explore our dataset and possibly perform any necessary data cleaning or augmentation.
2. [Building a TensorFlow model](https://deepnote.com/workspace/deepnote-8b0ebf6d-5672-4a8b-a488-2dd220383dd3/project/Customer-churn-modeling-1096d967-46f3-4233-8500-19b888b80b1d/notebook/2.%20Building%20a%20TensorFlow%20model-33c813c0beae4210ab3bdf55fd6e5a50) - where we conduct all our training
3. [Application](https://deepnote.com/workspace/deepnote-8b0ebf6d-5672-4a8b-a488-2dd220383dd3/project/Customer-churn-modeling-1096d967-46f3-4233-8500-19b888b80b1d/notebook/3.%20Application-88c92d2dc77a4242add2f64cb590f989) - where we load the trained model, and using Deepnote’s input blocks we allow other users (colleagues or other stakeholders) to run churn prediction according to their needs.

On top of our **Application** notebook we have built [this data app](https://deepnote.com/app/deepnote/Customer-churn-modeling-1096d967-46f3-4233-8500-19b888b80b1d), that simplifies the user experience for all stakeholders, especially the non-technical ones. This app can also be [embedded](https://deepnote.com/docs/data-apps#embedding) into 3rd party tools like Notion or Confluence.
