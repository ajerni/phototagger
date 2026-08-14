import { useEffect, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { LatLngExpression, Marker as LeafletMarker } from "leaflet";
import type { Photo } from "../../api/client";

type MemoryMapProps = {
  photos: Photo[];
  selectedPhotoId: number | null;
  onSelectPhoto: (photoId: number) => void;
  onInspectPhoto: (photoId: number) => void;
};

export function MemoryMap({
  photos,
  selectedPhotoId,
  onSelectPhoto,
  onInspectPhoto
}: MemoryMapProps) {
  const locatedPhotos = photos.filter(
    (photo) => photo.latitude !== null && photo.longitude !== null
  );
  const unlocatedCount = photos.length - locatedPhotos.length;
  const focusPhoto =
    locatedPhotos.find((photo) => photo.id === selectedPhotoId) ?? locatedPhotos[0] ?? null;
  const center: LatLngExpression = focusPhoto
    ? [focusPhoto.latitude!, focusPhoto.longitude!]
    : [37.8, -96.9];
  const markerRefs = useRef<Record<number, LeafletMarker | null>>({});

  return (
    <div className="map-frame">
      <MapContainer
        key={`${locatedPhotos[0]?.id ?? "none"}-${locatedPhotos.length}`}
        center={center}
        zoom={locatedPhotos.length > 0 ? 12 : 4}
        scrollWheelZoom
        className="leaflet-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FocusMarker
          photoId={focusPhoto?.id ?? null}
          latitude={focusPhoto?.latitude ?? null}
          longitude={focusPhoto?.longitude ?? null}
          markerRefs={markerRefs}
        />
        {locatedPhotos.map((photo) => (
          <Marker
            key={photo.id}
            position={[photo.latitude!, photo.longitude!]}
            zIndexOffset={selectedPhotoId === photo.id ? 900 : 0}
            ref={(instance) => {
              markerRefs.current[photo.id] = instance;
            }}
            eventHandlers={{ click: () => onSelectPhoto(photo.id) }}
          >
            <Popup className="memory-popup">
              <strong>{photo.analysis?.memory_caption || photo.filename}</strong>
              <p>{photo.analysis?.place_type || "GPS from EXIF metadata"}</p>
              <button type="button" onClick={() => onInspectPhoto(photo.id)}>
                Inspect photo
              </button>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      {locatedPhotos.length === 0 ? (
        <div className="map-empty">
          <span aria-hidden="true" />
          <strong>No GPS trail yet</strong>
          <p>Photos without EXIF coordinates still become memories, but precise map pins only come from metadata.</p>
        </div>
      ) : null}
      {locatedPhotos.length > 0 && unlocatedCount > 0 ? (
        <div className="map-note">{unlocatedCount} photo{unlocatedCount === 1 ? "" : "s"} without GPS</div>
      ) : null}
    </div>
  );
}

function FocusMarker({
  photoId,
  latitude,
  longitude,
  markerRefs
}: {
  photoId: number | null;
  latitude: number | null;
  longitude: number | null;
  markerRefs: { current: Record<number, LeafletMarker | null> };
}) {
  const map = useMap();

  useEffect(() => {
    if (photoId === null || latitude === null || longitude === null) {
      return;
    }
    map.flyTo([latitude, longitude], Math.max(map.getZoom(), 13));
    markerRefs.current[photoId]?.openPopup();
  }, [map, markerRefs, photoId, latitude, longitude]);

  return null;
}
