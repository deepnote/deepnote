---
title: Custom AI Models
description: Connect your own OpenAI-compatible endpoints to use with Deepnote Agent.
noIndex: false
noContent: false
---

Custom AI models allow Enterprise workspaces to connect their own OpenAI-compatible endpoints to use with Deepnote Agent. This feature gives you full control over the AI provider powering your data analysis workflows.

<Callout status="info">
Custom AI models are available exclusively on **Enterprise** plans.
</Callout>

<Callout status="warning">
Deepnote does not guarantee that Deepnote Agent will function as expected with custom models. While we support OpenAI-compatible endpoints, the quality and reliability of Agent's capabilities depend on your model's compatibility and performance.
</Callout>

## Overview

Custom AI models enable you to use your own AI infrastructure with Deepnote Agent instead of relying on Deepnote's native providers (OpenAI and Anthropic). This is particularly useful for organizations that:

- Need to use different providers for compliance or regional requirements
- Want to leverage proprietary or fine-tuned models
- Require data to stay within specific infrastructure boundaries

Your custom model endpoints must be OpenAI-compatible, meaning they follow the OpenAI API specification for chat completions. This ensures that Deepnote Agent can communicate with your endpoint using the same protocol it uses for native providers.

Custom models work with all AI features including Deepnote Agent, single block edits, and prompt suggestions. However, code completions continue to use Deepnote's dedicated completions provider and are not affected by custom model configuration. If this is a consideration, code completions can be disabled altogether in your workspace settings.

## Creating a Custom Model

To add a custom AI model to your workspace, you need workspace admin permissions with the ability to edit team settings. Follow these steps:

1. Navigate to your workspace **Settings & Members** page.

2. Click on the **AI** tab.

3. Scroll down to the **AI providers and custom models** section.

4. Click the **Add model** button.

5. In the modal that appears, fill in the required information:
   - **Custom model name**: A descriptive name for your model (e.g., "Azure GPT-4", "Llama Model")
   - **Endpoint URL**: The full URL to your OpenAI-compatible API endpoint
   - **Model ID**: The model identifier that your endpoint expects (e.g., "gpt-4", "gpt-oss-120b", "deepseek-r1")
   - **API key**: Your authentication key for the endpoint

6. Click **Connect model** to save your configuration.

### Endpoint URL Examples

Your endpoint URL should point to the base URL of your OpenAI-compatible API. Here are some common formats:

- **Generic OpenAI-compatible**: `https://api.example.com/v1`
- **Azure OpenAI**: `https://your-resource.openai.azure.com`
- **Amazon Bedrock**: `https://bedrock-runtime.us-east-1.amazonaws.com`
- **LiteLLM Gateway:**: `https://litellm.yourdomain.com/v1`
- **Hugging Face**: `https://router.huggingface.co/v1`

### Security Note

Your API key is encrypted and securely stored in Deepnote's infrastructure. It is only used to authenticate requests to your custom model endpoint and is never exposed to workspace users or included in logs.

## Setting as Workspace Default

Once you've created a custom model, you can set it as the default AI provider for your workspace:

1. In the **AI** settings page, locate the **Default AI provider or custom model** dropdown.

2. Click the dropdown to see available options. You'll see two groups:
   - **Native providers**: OpenAI and Anthropic (provided by Deepnote)
   - **Custom models**: Your configured custom models

3. Select your custom model from the list.

4. The selection is saved automatically. All Deepnote Agent features in your workspace will now use your custom model by default.

When a custom model is selected, it takes precedence over native providers. You can switch back to a native provider at any time by selecting OpenAI or Anthropic from the dropdown.

<Callout status="info">
Deepnote Agent must be enabled in your workspace settings for custom models to be used. If Agent is disabled, the custom model selection will be inactive.
</Callout>

## Managing Custom Models

You can edit or delete custom models from the **Custom models** section in AI settings:

- **Edit**: Click the edit icon next to a model to update its name, endpoint URL, model ID, or API key. When editing, you can leave the API key field empty to keep the existing key.
- **Delete**: Click the delete icon to remove a custom model. If the model is currently set as the workspace default, the selection will revert to OpenAI.

## Custom vs Native Models

Understanding the differences between custom models and Deepnote's native providers helps you make informed decisions about which option to use.

### Native Models (OpenAI and Anthropic)

Native models are provided and managed by Deepnote:

- **Guaranteed compatibility**: Deepnote ensures that Agent works reliably with these providers
- **No configuration required**: Simply select the provider and start using Agent
- **Automatic updates**: Deepnote handles model updates and improvements
- **Built-in optimization**: Agent is specifically tuned for these models
- **Support included**: Deepnote provides full support for issues related to native providers

### Custom Models

Custom models give you control but require more responsibility:

- **Full control**: Use any OpenAI-compatible endpoint
- **Configuration required**: You must provide and maintain endpoint URLs, model IDs, and API keys
- **OpenAI compatibility required**: Your endpoint must follow the OpenAI API specification
- **No guarantee of functionality**: Deepnote does not guarantee that Agent will work as expected with your custom model
- **Limited support**: Deepnote cannot troubleshoot issues specific to your model or endpoint

### Feature Comparison

| Feature                      | Native Models         | Custom Models                   |
| ---------------------------- | --------------------- | ------------------------------- |
| Deepnote Agent compatibility | Guaranteed            | Not guaranteed                  |
| Configuration                | None required         | Endpoint, model ID, API key     |
| Infrastructure               | Managed by Deepnote   | Managed by you                  |
| Cost                         | Included in plan      | Billed by your provider         |
| Data location                | Deepnote's providers  | Your infrastructure             |
| Support                      | Full Deepnote support | Limited to configuration issues |

### When to Use Custom Models

Custom models are ideal when:

- Your organization has specific compliance requirements
- You need data to remain within specific geographic or infrastructure boundaries
- You have proprietary or fine-tuned models optimized for your use case

### When to Use Native Models

Native models are recommended when:

- You want guaranteed compatibility with Deepnote Agent
- You prefer a zero-configuration setup
- You need full support from Deepnote for AI-related issues
- You want to benefit from Deepnote's ongoing optimizations

## Limitations and Considerations

When using custom models, keep these limitations in mind:

- **OpenAI compatibility is required**: Your endpoint must implement the OpenAI chat completions API specification. Endpoints that use different protocols will not work.

- **No guarantee of Agent functionality**: While Deepnote Agent is designed to work with OpenAI-compatible endpoints, we cannot guarantee that all Agent features will function correctly with your custom model. The quality of results depends on your model's capabilities.

- **Model capabilities vary**: Some models may not support all the features that Deepnote Agent relies on, such as function calling or specific response formats. This can affect Agent's ability to perform complex tasks.

- **Performance depends on your infrastructure**: Response times and reliability are determined by your endpoint's performance, not Deepnote's infrastructure.

- **API key security**: While Deepnote encrypts and securely stores your API keys, you are responsible for managing key rotation and access control on your endpoint.

- **Support scope**: Deepnote support can help with configuration issues but cannot troubleshoot problems specific to your model or endpoint.

## Troubleshooting

If you encounter issues with your custom model:

1. **Verify endpoint URL**: Ensure your endpoint URL is correct and accessible from Deepnote's infrastructure.

2. **Check API key**: Confirm that your API key is valid and has the necessary permissions.

3. **Test OpenAI compatibility**: Verify that your endpoint correctly implements the OpenAI chat completions API.

4. **Review model ID**: Ensure the model ID matches what your endpoint expects.

5. **Check endpoint logs**: Review your endpoint's logs for error messages or authentication failures.

If you continue to experience issues, contact Deepnote support with details about your configuration.
