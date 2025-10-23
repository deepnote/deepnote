---
title: Code reviews
noIndex: false
noContent: false
---

Enter Deepnote, the AI-powered data workspace designed to enhance collaboration, increase productivity, and simplify code reviews. We'll explore how to make the most of code reviews in Deepnote. From real-time collaboration to version control, we've got you covered.

## Workflows for Code Reviews in Deepnote

### Comments

Deepnote allows users to add comments directly within notebooks. This feature is essential for providing feedback during the review process. Reviewers can highlight specific lines of code or sections of the notebook and leave detailed comments or suggestions. This real-time feedback mechanism ensures that issues are addressed promptly, fostering a collaborative environment.

For example, if you spot a potential bug in a data processing block, you can immediately leave a comment, allowing the author to rectify it quickly. Comments will show in real-time, but the mail response will take some time. This interactive review process helps maintain code quality and reduces the chances of errors slipping through.
![Capture Aug 21.png](https://media.graphassets.com/AOtaKcF9RsqUcoC2P3JQ)

### History

The history feature in Deepnote tracks changes over time, allowing reviewers to see how a notebook has evolved. This is crucial for understanding the context of changes and ensuring that new code adheres to the project's standards. By reviewing the history, teams can ensure that all changes are deliberate and justified.

With a clear historical record, it's easy to identify when and why certain changes were made, enhancing transparency and accountability in the development process.
![Deepnote Screenshot Aug 21.png](https://media.graphassets.com/H87SmPZ3RFKQ1EzC5pYo)

### Notebook locking

Notebook locking prevents multiple users from editing the same notebook simultaneously, reducing the risk of conflicting changes. This feature is particularly useful during code reviews, as it ensures that the notebook remains stable while under review, and only authorized users can make changes.

This helps prevent situations where multiple reviewers might inadvertently overwrite each other's feedback or edits, ensuring a smoother and more coherent review process.
![Deepnote Screenshot Aug 21 (1).png](https://media.graphassets.com/rG54iTPSPuOVSy8qXGRT)

### Folder structure for workflow stages

Organize your projects using a folder structure to indicate their status in the review process. In Deepnote, we organize code reviews using the following folder structure:

- 🟡 **In progress:** notebooks are actively being worked on by the team.
- 🔄 **Under review:** notebooks are currently under code review.
- 🟢 **Live (or production, or scheduled):** approved notebooks ready for deployment or execution.
- 🏛️ **Archive:** completed notebooks that are no longer active but need to be retained for reference.

By moving projects between these folders, you can create a clear, visual workflow that tracks the status of each notebook.

### Versioning

Deepnote’s versioning capabilities allow you to track and manage different versions of a notebook. This is particularly useful when multiple people are contributing to the same project. Versioning ensures that you can always revert to previous versions if necessary and helps reviewers see the evolution of the code.

This feature is crucial for maintaining a clear record of changes and ensuring that any issues introduced by recent changes can be quickly identified and resolved.
![Aug 21 Screenshot from Notion.png](https://media.graphassets.com/Z1APPl5fQ1uvE8OoSdC4)

### Pair programming with real-time collaboration

In addition to traditional code reviews, consider using Deepnote’s real-time collaboration features for pair programming. This approach allows two or more team members to work on the same notebook simultaneously, making it easier to spot issues early and speeding up the development process. Real-time collaboration can serve as a dynamic form of code review, with peers providing immediate feedback and suggestions.

This collaborative approach fosters a sense of teamwork and accelerates problem-solving, leading to more efficient project completion.

### Code intelligence tools

Deepnote’s built-in code intelligence tools further enhance the review process. Features like autocomplete, linting, and code formatting help maintain code quality and reduce the number of errors. These tools can also assist reviewers in understanding the code more quickly, making the review process more efficient.

By leveraging these tools, your team can ensure that their code adheres to best practices and industry standards, resulting in cleaner, more reliable code.

## Integrating with GitHub, GitLab, Bitbucket, and Azure DevOps

For teams using version control systems like [GitHub](https://deepnote.com/docs/github), [GitLab](https://deepnote.com/docs/gitlab), [Bitbucket](https://deepnote.com/docs/bitbucket), or [Azure DevOps](https://deepnote.com/docs/azure-repos), Deepnote provides seamless integration. These integrations allow you to push and pull notebooks directly from your repositories, ensuring that your code is always in sync with your version control system. These integrations simplify the process of managing code changes and collaborating across different platforms, enhancing the overall efficiency of your development workflow.

## Using nbdime in Deepnote

For teams that need a more detailed comparison of notebook versions, nbdime is an excellent tool. It provides a clear, side-by-side comparison of notebook changes, making it easier to spot differences in code, outputs, and Markdown blocks. Deepnote’s integration with nbdime ensures that you can review changes efficiently without leaving the Deepnote environment.

This tool is particularly useful for comprehensive reviews, ensuring that every change is thoroughly vetted before being merged into the main project.
![Screenshot 2024-08-27 at 10.14.46.png](https://media.graphassets.com/IgZkGOgzT8OZWvhpbbMD)

## Combining Deepnote with GitHub and ReviewNB

To further enhance your code review workflow, consider integrating Deepnote with GitHub and [ReviewNB](https://www.reviewnb.com/). ReviewNB is a specialized tool for reviewing Jupyter Notebooks, and it provides a user-friendly interface for commenting on notebooks within GitHub pull requests. By combining these tools, you can create a seamless review process that leverages the strengths of each platform. This combination provides a robust framework for managing notebook reviews, ensuring that all feedback is captured and addressed efficiently.
![Aug 27 Screenshot from Code Reviews.png](https://media.graphassets.com/g3aRnhWkTnWFQZ1j9oZd)

From real-time collaboration to detailed version tracking and seamless integrations with popular version control systems, Deepnote offers everything you need to maintain high code quality and streamline your development process. Ready to take your code reviews to the next level? Start using Deepnote today and experience the difference in your team's productivity and code quality.
