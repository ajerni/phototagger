from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image


def test_photo_upload_rejects_non_image(client):
    trip = client.post("/api/trips", json={"title": "Kyoto"}).json()

    response = client.post(
        f"/api/trips/{trip['id']}/photos",
        files=[("files", ("notes.txt", b"not an image", "text/plain"))],
    )

    assert response.status_code == 400


def test_photo_routes_return_404_for_missing_trip(client):
    response = client.get("/api/trips/999/photos")
    assert response.status_code == 404

    upload_response = client.post(
        "/api/trips/999/photos",
        files=[("files", ("missing.jpg", _image_bytes(), "image/jpeg"))],
    )
    assert upload_response.status_code == 404


def test_photo_upload_accepts_image_and_stores_metadata(client):
    trip = client.post("/api/trips", json={"title": "Kyoto"}).json()
    image = BytesIO()
    Image.new("RGB", (8, 8), color="red").save(image, format="JPEG")
    image.seek(0)

    response = client.post(
        f"/api/trips/{trip['id']}/photos",
        files=[("files", ("temple.jpg", image.getvalue(), "image/jpeg"))],
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["filename"] == "temple.jpg"
    assert payload[0]["image_url"].startswith("/uploads/trip_")

    list_response = client.get(f"/api/trips/{trip['id']}/photos")
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1


def test_photo_upload_persists_gps_from_exif(client):
    from backend.tests.test_exif import build_jpeg

    trip = client.post("/api/trips", json={"title": "Bahamas"}).json()
    image = build_jpeg(
        gps={1: "N", 2: (24.0, 14.0, 13.49), 3: "W", 4: (77.0, 37.0, 57.78)},
        date_time_original="2026:07:18 14:02:53",
    )

    response = client.post(
        f"/api/trips/{trip['id']}/photos",
        files=[("files", ("hammock.jpg", image, "image/jpeg"))],
    )

    assert response.status_code == 200
    photo = response.json()[0]
    assert photo["latitude"] == pytest.approx(24.23708, abs=1e-5)
    assert photo["longitude"] == pytest.approx(-77.63272, abs=1e-5)

    listed = client.get(f"/api/trips/{trip['id']}/photos").json()[0]
    assert listed["latitude"] == pytest.approx(24.23708, abs=1e-5)
    assert listed["longitude"] == pytest.approx(-77.63272, abs=1e-5)


def test_photo_import_persists_gps_from_exif(client):
    from backend.tests.test_exif import build_jpeg

    trip = client.post("/api/trips", json={"title": "Bahamas"}).json()
    image = build_jpeg(gps={1: "S", 2: (33.0, 51.0, 30.0), 3: "E", 4: (151.0, 12.0, 36.0)})

    response = client.post(
        f"/api/trips/{trip['id']}/photos/import",
        files=[("files", ("sydney.jpg", image, "image/jpeg"))],
    )

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["status"] == "stored"
    assert result["photo"]["latitude"] == pytest.approx(-33.85833, abs=1e-5)
    assert result["photo"]["longitude"] == pytest.approx(151.21, abs=1e-5)


def _image_bytes() -> bytes:
    image = BytesIO()
    Image.new("RGB", (8, 8), color="red").save(image, format="JPEG")
    return image.getvalue()
