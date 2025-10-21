---
title: Auto-grading
noIndex: false
noContent: false
---

Deepnote doesn't have integrated auto-grading solutions, but we've put together a list of useful packages that will do the job for you. Each library has a different setup and uses slightly different grading mechanisms.

The simplest solution is to include the tests in the student's assignments. This allows students to run the tests themselves. Keep in mind, it may also allow them to potentially use the tests to skirt the assignment.

<Callout status="info">
The auto-grading solutions below don't provide comprehensive support for grading multiple hundreds of assignments.
</Callout>

There are three types of tests: unit tests, hidden unit tests with immediate scores, and hidden unit tests with scores after submission. Sometimes you may want to test a variable value, not a function, so those are included first.

## 1. OKpy library

![ok.png](https://media.graphassets.com/a0ArnM3CTraGLVgFsEIB)

The ok.py software was developed for CS 61A at UC Berkeley. This library supports programming projects by running tests, tracking progress, and assisting in debugging. You can find the entire GitHub repository for the library [here!](https://github.com/okpy/ok)
<Callout status="info">
Check out our [Deepnote notebook with OKpy library](https://deepnote.com/workspace/Deepnote-classroom-template-ef3ec34d-be29-481f-a95d-9384fc1dd07e/project/1-OKpy-library-bce337dc-57c6-47a0-a293-e64920c2f515//OKpy%20testing%20Notebook%20.ipynb) template to learn more. You can duplicate it and use it for your own purposes.
</Callout>

## 2. Tests from imported files

![Group 3919.png](https://media.graphassets.com/PvaD3OscSa6LsCU65zus)

This is a simple test that functions with asserts in separate files. A useful thing about separate files is that they can be switched later.

<Callout status="info">
Check out our [Deepnote notebook with tests from imported files](https://deepnote.com/workspace/Deepnote-classroom-template-ef3ec34d-be29-481f-a95d-9384fc1dd07e/project/2-Tests-from-imported-files-4aa58a5c-31bf-4475-8f13-791880020c20/notebook/Test%20from%20imported%20files-d267139d9ca14595b7f3b05819f7361e) template to learn more. You can duplicate it and use it for your own purposes.
</Callout>

## 3. Inline tests

![Screenshot 2022-12-22 at 14.37.59.png](https://media.graphassets.com/reDZIR4yR2a1xW9X8OG4)

In-line tests are small pieces of code used to test a specific function or aspect of a more extensive program. They're often used to validate the correctness of code and ensure it's working as intended. In-line tests are usually written within the same file as the code being tested, hence their name.

<Callout status="info">
Check out our [Deepnote notebook with inline tests](https://deepnote.com/workspace/Deepnote-classroom-template-ef3ec34d-be29-481f-a95d-9384fc1dd07e/project/3-In-line-tests-fd5a8ed1-8f4e-4a30-a60b-64f57ed50221) template to learn more. You can duplicate it and use it for your own purposes.
</Callout>

## 4. Doc tests

![Screenshot 2022-12-22 at 14.30.05.png](https://media.graphassets.com/HcSdwO3KQPGwbVVMHqNM)

Doc tests are a way to embed test cases within the documentation for a piece of code. They allow developers to specify expected input and output for a given function or method, and then automatically verify that the code produces the expected results when run. Doc tests are often used to ensure that code examples in the documentation are accurate and up to date.

<Callout status="info">
Check out our [Deepnote notebook with doc tests](https://deepnote.com/workspace/Deepnote-classroom-template-ef3ec34d-be29-481f-a95d-9384fc1dd07e/project/4-Doc-tests-1e6f63a1-039d-493c-8d96-9b2ef1053a84) template to learn more. You can duplicate it and use it for your own purposes.
</Callout>

### 5.) Unit tests

![Screenshot 2022-12-22 at 14.32.21.png](https://media.graphassets.com/BdWLwJfySTCH1ymnKQGJ)

Unit tests are small, isolated tests that verify the correctness of a specific component or unit of code. They're used to make sure individual parts of a larger program are working correctly, and are typically written by developers as they're writing code. Unit tests are generally automated, meaning they can be run automatically by a testing framework or tool with the results being checked automatically as well.

<Callout status="info">
Check out our [Deepnote notebook with unit tests](https://deepnote.com/workspace/Deepnote-classroom-template-ef3ec34d-be29-481f-a95d-9384fc1dd07e/project/5-Unit-tests-23f45656-3ca5-4814-a8f8-f69c04f48165) template to learn more. You can duplicate it and use it for your own purposes.
</Callout>
