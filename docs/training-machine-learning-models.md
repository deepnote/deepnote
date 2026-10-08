---
title: Training machine learning models
noIndex: false
noContent: false
---

Deepnote offers machine learning engineers a comprehensive set of features comparable to those found in Jupyter notebook and Google Colab, with additional enhancements designed to improve the user experience and collaboration.

One of Deepnote’s standout features is its real-time collaboration, which allows multiple users to work simultaneously on the same notebook. Another advantage is its integration with various data sources and its advanced monitoring and analysis tools. These features simplify the tasks for data scientists and machine learning engineers, allowing them to concentrate on building and improving models more efficiently.

## Possibilities for training machine learning models in Deepnote notebook

### Machine learning frameworks

**Scikit-learn, PyTorch, and TensorFlow, Keras, JAX integration**

Deepnote allows smooth integration with Scikit-learn, a robust library for traditional machine learning algorithms. For deep learning enthusiasts, this notebook supports PyTorch, TensorFlow and Keras - three of the most popular frameworks for building and training neural networks.

**Scikit-learn** is a popular open-source machine learning library for Python. It provides a range of algorithms for classification, regression, and clustering, such as support-vector machines, random forests, gradient boosting, k-means, and DBSCAN. Scikit-learn is designed to work seamlessly with Python's numerical and scientific libraries like NumPy and SciPy.

**TensorFlow** is software library developed by Google for machine learning and artificial intelligence applications. It provides an ecosystem for building, training, and deploying machine learning models. TensorFlow excels in handling complex tasks related to deep learning, particularly with its focus on deep neural networks.

The TensorFlow example project includes three notebooks organized within a single [project](https://deepnote.com/workspace/deepnote-8b0ebf6d-5672-4a8b-a488-2dd220383dd3/project/Customer-churn-modeling-1096d967-46f3-4233-8500-19b888b80b1d/notebook/2.%20Building%20a%20TensorFlow%20model-33c813c0beae4210ab3bdf55fd6e5a50).

**PyTorch** is a machine learning library based on the Torch library, designed for applications such as computer vision and natural language processing. PyTorch is widely regarded as one of the two leading machine learning libraries, alongside TensorFlow.

**JAX** is an open-source library from Google built for high-performance computing in machine learning and AI. It simplifies building and optimizing complex functions with automatic differentiation and JIT compilation. Ideal for deep learning, JAX scales easily across GPUs and TPUs, making it great for experimenting with advanced neural networks.

For those who want to learn more, here’s an article about [JAX](https://deepnote.com/docs/exploring-jax). Since users often struggle with whether to choose JAX pr PyTorch, here’s a quick comparison: [JAX vs. PyTorch](https://deepnote.com/docs/jax-vs-pytorch). To see JAX in real-world use, here’s a data app: _[Model fitting and evaluation with JAX.](https://deepnote.com/app/deepnote/JAX-93f79619-9557-4a82-b58e-bfe548891f0b?utm_content=93f79619-9557-4a82-b58e-bfe548891f0b)_

**Keras** is an open-source library that provides a Python interface for building and training artificial neural networks. It is integrated into the TensorFlow ecosystem, improving its capabilities and accessibility.

## ChatGPT API, Hugging Face models and Groq

Deepnote supports integration of advanced AI models through the ChatGPT API and pre-trained models from Hugging Face. The ChatGPT API, developed by OpenAI, allows users to incorporate natural language capabilities into their applications. The API is ideal for creating chatbots, generating human-like text, and creating text analysis in general.

Hugging Face provides a repository of pre-trained models that cover a wide range of tasks, including natural language processing, computer vision, and more. These models, which include BERT, GPT-3, LLama and other architectures, can be easily integrated into Deepnote projects. Using Hugging Face models, machine learning engineers can quickly deploy AI solutions without the need for extensive computational resources or training time. If you want to utilize Deepnote and hugging face here is a quick [set-up](https://deepnote.com/workspace/Deepnote-8b0ebf6d-5672-4a8b-a488-2dd220383dd3/project/PDF-to-podcast-LLAMA-32-e420c67e-f3cb-4687-a603-0eb8e0505fcd/notebook/0-Introduction-662fd913418d43828e196b650ec69263), and if you want learn how to use llama and hugging face here is a [tutorial](https://deepnote.com/workspace/Deepnote-8b0ebf6d-5672-4a8b-a488-2dd220383dd3/project/PDF-to-podcast-LLAMA-32-e420c67e-f3cb-4687-a603-0eb8e0505fcd/notebook/01-PDF-to-podcast-app-6d58a8c72ee542a7b33252489a3a5c9a)

Groq is a high-speed AI processing platform that seamlessly integrates with OpenAI tools, delivering ultra-fast inference for machine learning models. Paired with Llama, a powerful language model designed for natural language understanding and generation, it enables advanced AI capabilities for various applications, from financial data analysis to AI-driven insights.

Deepnote makes it easy to integrate AI models, and to help with that, [here’s a tutorial](https://deepnote.com/app/deepnote/Tutorial-Groq-LLamav2-ffa248f7-876f-476f-b393-9c80658726ca?utm_source=app-settings&utm_medium=product-shared-content&utm_campaign=data-app&utm_content=ffa248f7-876f-476f-b393-9c80658726ca), how to set up Groq & Llama within your notebook.

For those interested, check out the [AI stock assistant powered by Groq and Llama3](https://deepnote.com/explore/ai-stock-assistant-powered-by-groq-and-llama3). 🦙

## Third-party services and tools

Users can connect to cloud storage solutions such as Google Cloud Storage or Azure Blob Storage, ensuring easy access to large datasets. Databases like PostgreSQL, MySQL, and MongoDB can also be integrated for better data storage and retrieval.

BEAM is a platform designed to streamline the deployment of inference, train AI models, and autoscale machine learning workloads across GPUs and CPUs without the complexity of managing infrastructure. This innovative service is beneficial to enhance the scalability and efficiency in deploying machine learning models.

For training larger models and experimenting with various parameters, using tools like TensorBoard, [Weights and Biases](https://deepnote.com/docs/weights-and-biases), or [Comet.ml](https://deepnote.com/docs/cometml) is recommended. These tools are useful for monitoring and optimizing the training process. The user can visualize metrics such as loss and accuracy over time, and get insights into the model's performance. All three tools also allow real-time monitoring of model performance, helping to identify issues early in the process and more.

Integrations with data visualization libraries like Plotly and Tableau allow to create various insights and share findings with stakeholders. Additionally, the Deepnote's built-in graphing capabilities offer quick and efficient way to plot directly within notebooks, further streamlining the data visualization process in the Deepnote data apps.

## Conclusion

Deepnote stands out as a comprehensive platform for training machine learning models, offering a real-time collaboration, seamless data integration, and advanced monitoring tools. With support for popular libraries like Scikit-learn, TensorFlow, PyTorch, and Keras, it suits wide range of machine learning needs. Deepnote's robust features and user-friendly interface make it an great choice for efficiently building, training, and deploying machine learning models with effective collaboration and insightful data analysis.
