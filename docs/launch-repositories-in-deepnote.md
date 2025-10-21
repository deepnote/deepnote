---
title: Launch repositories in Deepnote
noIndex: false
noContent: false
---

Deepnote supports launching repositories as Deepnote projects (so every user who clicks on the link will see a new project created just for them with the contents of the repository).

[See examples on GitHub](https://github.com/SuNaden/deepnote-launch-example)

### Launching repositories in Deepnote

Deepnote supports launching repositories as Deepnote projects (so every user who clicks on the link will see a new project created just for them with the contents of the repository). Copy the link below and URL encode your repository link (you can use [https://www.urlencoder.io/](https://www.urlencoder.io/)).

Example launch link (don't forget to URL encode the link you want to open)

```
https://deepnote.com/launch?url=<URL_ENCODED_LINK>
```

Full example with converting [`https://github.com/norvig/pytudes`](https://github.com/norvig/pytudes) to a Deepnote launch link

```
https://deepnote.com/launch?url=https%3A%2F%2Fgithub.com%2Fnorvig%2Fpytudes%2Fblob%2Fmaster%2Fipynb%2FAdvent-2018.ipynb
```

Example of a Deepnote launch link can be seen in the `README.md` of the [pytudes repository](https://github.com/norvig/pytudes)

The url doesn't have to be a GitHub repository, it can also be a direct link to an `.ipynb` file. You can also add a name parameter in the url.

```
https://deepnote.com/launch?name=MyProject&url=https://company.com/link/to/static/notebook.ipynb
```

### Adding a Deepnote launch button

[Github repository with button examples](https://github.com/SuNaden/deepnote-launch-example)

#### Launch in Deepnote - Black

Button link

```
// Large button
https://deepnote.com/buttons/launch-in-deepnote.svg

// Small (badge-style) button
https://deepnote.com/buttons/launch-in-deepnote-small.svg
```

Example usage in a markdown file (e.g. `README.md`)

```
// Large button
[<img src="https://deepnote.com/buttons/launch-in-deepnote.svg">](PROJECT_URL)

// Small (badge-style) button
[<img src="https://deepnote.com/buttons/launch-in-deepnote-small.svg">](PROJECT_URL)
```

#### Launch in Deepnote - White

Button link

```
// Large button
https://deepnote.com/buttons/launch-in-deepnote-white.svg

// Small (badge-style) button
https://deepnote.com/buttons/launch-in-deepnote-white-small.svg
```

Example usage in a markdown file (e.g. `README.md`)

```
// Large button
[<img src="https://deepnote.com/buttons/launch-in-deepnote-white.svg">](PROJECT_URL)

// Small (badge-style) button
[<img src="https://deepnote.com/buttons/launch-in-deepnote-white-small.svg">](PROJECT_URL)
```

#### **Try in a Jupyter notebook - Black**

Button link

```
// Large button
https://deepnote.com/buttons/try-in-a-jupyter-notebook.svg

// Small (badge-style) button
https://deepnote.com/buttons/try-in-a-jupyter-notebook-small.svg
```

Example usage in a markdown file (e.g. `README.md`)

```
// Large button
[<img src="https://deepnote.com/buttons/try-in-a-jupyter-notebook.svg">](PROJECT_URL)

// Small (badge-style) button
[<img src="https://deepnote.com/buttons/try-in-a-jupyter-notebook-small.svg">](PROJECT_URL)
```

#### **Try in a Jupyter notebook -**

Button link

```
// Large button
https://deepnote.com/buttons/try-in-a-jupyter-notebook-white.svg

// Small (badge-style) button
https://deepnote.com/buttons/try-in-a-jupyter-notebook-white-small.svg
```

Example usage in a markdown file (e.g. `README.md`)

```
// Large button
[<img src="https://deepnote.com/buttons/try-in-a-jupyter-notebook-white.svg">](PROJECT_URL)

// Small (badge-style) button
[<img src="https://deepnote.com/buttons/try-in-a-jupyter-notebook-white-small.svg">](PROJECT_URL)
```
