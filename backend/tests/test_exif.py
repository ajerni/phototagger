from __future__ import annotations

from io import BytesIO

import pytest
from PIL import ExifTags, Image

from backend.app.services.exif import extract_exif


def build_jpeg(
    *,
    gps: dict[int, object] | None = None,
    date_time_original: str | None = None,
    date_time_digitized: str | None = None,
    date_time: str | None = None,
) -> bytes:
    exif = Image.Exif()
    if date_time is not None:
        exif[0x0132] = date_time
    if date_time_original is not None:
        exif.get_ifd(ExifTags.IFD.Exif)[0x9003] = date_time_original
    if date_time_digitized is not None:
        exif.get_ifd(ExifTags.IFD.Exif)[0x9004] = date_time_digitized
    if gps:
        gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)
        gps_ifd.update(gps)

    buffer = BytesIO()
    Image.new("RGB", (8, 8), "blue").save(buffer, "JPEG", exif=exif)
    return buffer.getvalue()


def test_extracts_gps_from_nested_gps_ifd():
    image = build_jpeg(
        gps={
            1: "N",
            2: (24.0, 14.0, 13.49),
            3: "W",
            4: (77.0, 37.0, 57.78),
        }
    )

    result = extract_exif(image)

    assert result.latitude == pytest.approx(24.23708, abs=1e-5)
    assert result.longitude == pytest.approx(-77.63272, abs=1e-5)
    assert result.raw["GPSInfo"]["GPSLatitudeRef"] == "N"


def test_southern_and_eastern_hemispheres_are_signed():
    image = build_jpeg(
        gps={
            1: "S",
            2: (33.0, 51.0, 30.0),
            3: "E",
            4: (151.0, 12.0, 36.0),
        }
    )

    result = extract_exif(image)

    assert result.latitude == pytest.approx(-33.85833, abs=1e-5)
    assert result.longitude == pytest.approx(151.21, abs=1e-5)


def test_missing_gps_yields_none_coordinates():
    result = extract_exif(build_jpeg(date_time="2026:07:18 14:02:53"))

    assert result.latitude is None
    assert result.longitude is None


def test_partial_gps_without_reference_is_rejected():
    image = build_jpeg(gps={2: (24.0, 14.0, 13.49)})

    result = extract_exif(image)

    assert result.latitude is None
    assert result.longitude is None


def test_date_time_original_is_preferred_over_date_time():
    image = build_jpeg(
        date_time="2026:07:20 09:00:00",
        date_time_original="2026:07:18 14:02:53",
    )

    result = extract_exif(image)

    assert result.captured_at is not None
    assert result.captured_at.isoformat() == "2026-07-18T14:02:53"


def test_date_time_original_wins_over_digitized():
    image = build_jpeg(
        date_time="2026:07:20 09:00:00",
        date_time_digitized="2026:07:19 08:00:00",
        date_time_original="2026:07:18 14:02:53",
    )

    result = extract_exif(image)

    assert result.captured_at is not None
    assert result.captured_at.isoformat() == "2026-07-18T14:02:53"


def test_non_image_bytes_are_handled():
    result = extract_exif(b"definitely not a jpeg")

    assert result.latitude is None
    assert result.longitude is None
    assert result.captured_at is None
    assert result.raw == {}
