import pytest

from pdf_extract.classifiers import (
    REGISTRY,
    Classifier,
    available_classifiers,
    get_classifier,
)


def test_gemini_is_registered():
    assert "gemini-flash" in REGISTRY
    assert "gemini-flash" in available_classifiers()


def test_get_classifier_returns_classifier_instance():
    c = get_classifier("gemini-flash")
    assert isinstance(c, Classifier)
    assert c.name == "gemini-flash"
    assert c.version  # non-empty


def test_get_classifier_unknown_lists_options():
    with pytest.raises(KeyError) as exc:
        get_classifier("does-not-exist")
    assert "gemini-flash" in str(exc.value)
