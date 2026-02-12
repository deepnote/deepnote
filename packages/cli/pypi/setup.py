from wheel.bdist_wheel import bdist_wheel as _bdist_wheel


class bdist_wheel(_bdist_wheel):
    """Mark wheel as platform-specific since it bundles a native executable."""

    def finalize_options(self):
        super().finalize_options()
        self.root_is_pure = False


setup_kwargs = {
    "cmdclass": {"bdist_wheel": bdist_wheel},
}


if __name__ == "__main__":
    from setuptools import setup

    setup(**setup_kwargs)
