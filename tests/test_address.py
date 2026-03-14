from pdf_extract.address import address_key, format_address, parse_address


def test_format_address_full():
    result = format_address("155 State Street", None, "Corning", "NY", "14830")
    assert result == "155 State Street, Corning, NY 14830"


def test_format_address_with_line2():
    result = format_address("155 State Street", "Suite 200", "Corning", "NY", "14830")
    assert result == "155 State Street, Suite 200, Corning, NY 14830"


def test_format_address_missing_fields():
    assert format_address(None, None, None, None, None) == ""
    assert format_address("123 Main", None, None, None, None) == "123 Main"
    assert format_address(None, None, "Corning", "NY", None) == "Corning, NY"


def test_address_key_deterministic():
    key1 = address_key("155 State Street", None, "Corning", "NY", "14830")
    key2 = address_key("155 State Street", None, "Corning", "NY", "14830")
    assert key1 == key2
    assert key1 == "155 State Street||Corning|NY|14830"


def test_address_key_different():
    key1 = address_key("155 State Street", None, "Corning", "NY", "14830")
    key2 = address_key("158 State Street", None, "Corning", "NY", "14830")
    assert key1 != key2


def test_parse_address_standard():
    result = parse_address("155 State Street, Corning, NY 14830")
    assert result == {
        "line1": "155 State Street",
        "line2": None,
        "city": "Corning",
        "state": "NY",
        "postal_code": "14830",
    }


def test_parse_address_empty():
    result = parse_address("")
    assert result["line1"] is None


def test_parse_address_fallback():
    result = parse_address("Some weird address")
    assert result["line1"] == "Some weird address"
    assert result["city"] is None
