import L from 'leaflet';
import { Focus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { GeoJSON, LayersControl, MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface MapGeometryViewerProps {
  geojson: any;
  /** GeoJSON FeatureCollection of EUDR risk zones, drawn in red. */
  riskZones?: any;
  className?: string;
}

/** Union the bounds of every supplied GeoJSON dataset (parcel + risk
 *  zones) so the red overlays sitting beside the plot stay in view. */
function boundsOf(datasets: any[]): L.LatLngBounds | null {
  const group = L.featureGroup();
  for (const d of datasets) {
    if (d && (d.features?.length || d.type)) group.addLayer(L.geoJSON(d));
  }
  const b = group.getBounds();
  return b.isValid() ? b : null;
}

function FitBounds({ datasets }: { datasets: any[] }) {
  const map = useMap();

  useEffect(() => {
    const bounds = boundsOf(datasets);
    if (bounds) {
      // The card lays out (and the map's height) after the map first
      // mounts, so Leaflet's cached container size is stale → fitBounds
      // would centre against the wrong dimensions. Recompute size first.
      map.invalidateSize();
      // Prevent zooming too far in for tiny parcels/points where tiles aren't available
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
    }
  }, [datasets, map]);

  return null;
}

function ZoomToFarmControl({ geojson }: { geojson: any }) {
  const map = useMap();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const CustomControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: () => {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        setContainer(div);
        return div;
      },
      onRemove: () => {
        setContainer(null);
      },
    });

    const control = new CustomControl();
    map.addControl(control);

    return () => {
      map.removeControl(control);
    };
  }, [map]);

  if (!container) return null;

  return createPortal(
    // biome-ignore lint/a11y/useValidAnchor: Leaflet's CSS requires an anchor tag for control buttons
    <a
      href="#"
      // Use Leaflet's standard dimensions (26px by default, 30px on touch devices)
      // but override the inner display to center the Lucide icon.
      // `!` (important) so these beat Leaflet's higher-specificity
      // `.leaflet-bar a` defaults (white bg / #333 text) which otherwise
      // leave the control invisible against the dark-theme map.
      className="!flex !items-center !justify-center !border !border-border !bg-background !text-foreground hover:!bg-muted"
      style={{ width: '30px', height: '30px' }} // Leaflet touch size, which is what the user's screenshot shows
      title="Zoom to Farm"
      onClick={(e) => {
        e.preventDefault();
        const bounds = L.geoJSON(geojson).getBounds();
        if (bounds.isValid()) {
          map.invalidateSize();
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
        }
      }}
    >
      <Focus className="h-4 w-4" />
    </a>,
    container,
  );
}

// Red styling for a risk-zone feature; `high` severity reads darker.
function riskZoneStyle(feature?: { properties?: { severity?: string } }) {
  const high = feature?.properties?.severity === 'high';
  return {
    color: high ? '#b91c1c' : '#ef4444',
    weight: 2,
    fillColor: high ? '#dc2626' : '#f87171',
    fillOpacity: 0.35,
    dashArray: '4 3',
  };
}

function onEachRiskZone(feature: any, layer: L.Layer) {
  const p = feature?.properties ?? {};
  const label = (p.riskType === 'protected_area' ? 'Protected area' : 'Deforestation') as string;
  layer.bindPopup(
    `<strong>${label}</strong><br/>Severity: ${p.severity ?? '—'}${p.name ? `<br/>${p.name}` : ''}`,
  );
}

export function MapGeometryViewer({ geojson, riskZones, className }: MapGeometryViewerProps) {
  if (!geojson) return null;

  const hasRiskZones = !!riskZones?.features?.length;

  return (
    <div
      className={`relative z-0 w-full overflow-hidden rounded-md border bg-muted/30 ${className || 'h-[300px]'}`}
    >
      <style>{`
        .leaflet-container img.leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
        }
        /* More breathing room between the base-layer radio rows. */
        .leaflet-control-layers-base label {
          display: flex;
          align-items: center;
          margin-bottom: 6px;
        }
        .leaflet-control-layers-base label:last-child {
          margin-bottom: 0;
        }
      `}</style>
      <MapContainer
        key="map-container-v3"
        center={[0, 0]}
        zoom={2}
        // Scroll-wheel zoom off so the mouse wheel scrolls the page instead
        // of hijacking to zoom. Zoom stays available via the +/− control
        // buttons and the keyboard (+/−) when the map is focused.
        scrollWheelZoom={false}
        className="h-full w-full z-0"
      >
        <LayersControl position="topright" collapsed={false}>
          <LayersControl.BaseLayer checked={true} name="Google Earth Satellite">
            <TileLayer
              attribution="&copy; Google"
              url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
              maxZoom={22}
              maxNativeZoom={20}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Open Street Map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={22}
              maxNativeZoom={19}
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {hasRiskZones && (
          <GeoJSON
            key={`risk-${JSON.stringify(riskZones)}`}
            data={riskZones}
            style={riskZoneStyle}
            onEachFeature={onEachRiskZone}
          />
        )}
        <GeoJSON
          key={JSON.stringify(geojson)}
          data={geojson}
          style={{ color: '#16a34a', weight: 2, fillOpacity: 0.2 }}
        />
        <FitBounds datasets={[geojson, riskZones]} />
        <ZoomToFarmControl geojson={geojson} />
      </MapContainer>
    </div>
  );
}
