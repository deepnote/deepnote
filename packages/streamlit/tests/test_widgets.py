from datetime import date
from typing import Any

from deepnote_streamlit import InputBlock, render_inputs


class FakeContainer:
    def checkbox(self, _label: str, **kwargs: Any) -> Any:
        return kwargs["value"]

    def multiselect(self, _label: str, _options: list[str], **kwargs: Any) -> Any:
        return kwargs["default"]

    def selectbox(self, _label: str, options: list[str], **kwargs: Any) -> Any:
        return options[kwargs["index"]]

    def slider(self, _label: str, **kwargs: Any) -> Any:
        return kwargs["value"]

    def date_input(self, _label: str, **kwargs: Any) -> Any:
        return kwargs["value"]

    def text_area(self, _label: str, **kwargs: Any) -> Any:
        return kwargs["value"]

    def text_input(self, _label: str, **kwargs: Any) -> Any:
        return kwargs["value"]


def test_render_inputs_maps_all_deepnote_input_types_to_api_values() -> None:
    inputs = [
        InputBlock("name", "input-text", "Ada"),
        InputBlock("notes", "input-textarea", "Hello"),
        InputBlock("enabled", "input-checkbox", True),
        InputBlock("region", "input-select", "Europe", options=("All", "Europe")),
        InputBlock("regions", "input-select", ["Europe"], options=("All", "Europe"), multiple=True),
        InputBlock("limit", "input-slider", "20", min=10, max=100, step=10),
        InputBlock("as_of", "input-date", date(2026, 8, 17)),
        InputBlock("period", "input-date-range", [date(2026, 8, 1), date(2026, 8, 17)]),
    ]

    assert render_inputs(inputs, FakeContainer()) == {
        "name": "Ada",
        "notes": "Hello",
        "enabled": True,
        "region": "Europe",
        "regions": ["Europe"],
        "limit": 20,
        "as_of": "2026-08-17",
        "period": ["2026-08-01", "2026-08-17"],
    }


def test_incomplete_date_range_is_still_valid_for_runner_contract() -> None:
    class IncompleteDateContainer(FakeContainer):
        def date_input(self, _label: str, **_kwargs: Any) -> Any:
            return (date(2026, 8, 17),)

    values = render_inputs(
        [InputBlock("period", "input-date-range", [date(2026, 8, 1), date(2026, 8, 17)])],
        IncompleteDateContainer(),
    )

    assert values == {"period": ["2026-08-17", "2026-08-17"]}


def test_slider_preserves_fractional_default_with_integer_bounds() -> None:
    class SliderContainer(FakeContainer):
        slider_kwargs: dict[str, Any]

        def slider(self, _label: str, **kwargs: Any) -> Any:
            self.slider_kwargs = kwargs
            return kwargs["value"]

    container = SliderContainer()
    values = render_inputs(
        [InputBlock("threshold", "input-slider", "20.5", min=10, max=30, step=0.5)],
        container,
    )

    assert values == {"threshold": 20.5}
    assert container.slider_kwargs == {
        "min_value": 10.0,
        "max_value": 30.0,
        "value": 20.5,
        "step": 0.5,
        "key": "deepnote:threshold",
    }
