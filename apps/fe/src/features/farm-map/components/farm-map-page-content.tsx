/**
 * Full-screen farm map — every mapped plot in the active cooperative,
 * coloured by EUDR status, with the deforestation / protected-area zones
 * drawn over them.
 *
 * This is the compliance picture a European buyer asks for in one screen:
 * where the plots are, which ones are cleared, and which sit next to a
 * risk area. The per-parcel map on the farm detail page answers the same
 * question for a single plot; this one answers it for the whole book.
 *
 * Everything arrives in ONE request (`/api/parcels/map`) — a thousand
 * plots is a thousand round trips otherwise — and the geometry is
 * simplified server-side, so panning stays smooth.
 */

import L from 'leaflet';
import { Loader2, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { GeoJSON, LayersControl, MapContainer, TileLayer, useMap } from 'react-leaflet';
import { ErrorBanner } from '@/components/ui/error-banner';
import { StatusTag } from '@/components/ui/status-tag';
import { type GeoJsonFeatureCollection, useParcelMap } from '@/shared/api';
import 'leaflet/dist/leaflet.css';

// EUDR palette, shared with the status tags elsewhere in the app so a
// green polygon and a green chip mean the same thing.
const STATUS_COLOURS: Record<string, string> = {
  compliant: '#16a34a',
  needs_review: '#f59e0b',
  non_compliant: '#dc2626',
  unknown: '#94a3b8',
};

function parcelStyle(feature?: { properties?: Record<string, unknown> }) {
  const status = String(feature?.properties?.eudrStatus ?? 'unknown');
  const colour = STATUS_COLOURS[status] ?? STATUS_COLOURS.unknown;
  // A plot flagged high-risk gets a heavier outline: at country zoom the
  // fill of a 2-hectare polygon is a couple of pixels, so weight is the
  // only thing that actually reads.
  const high = feature?.properties?.deforestationRisk === 'high';
  return {
    color: colour,
    weight: high ? 3 : 1,
    fillColor: colour,
    fillOpacity: 0.45,
  };
}

function riskZoneStyle(feature?: { properties?: { severity?: string } }) {
  const high = feature?.properties?.severity === 'high';
  return {
    color: high ? '#b91c1c' : '#ef4444',
    weight: 2,
    fillColor: high ? '#dc2626' : '#f87171',
    fillOpacity: 0.3,
    dashArray: '4 3',
  };
}

/** Points have no area to fill — draw them as small circles instead of
 *  Leaflet's default pin, which would bury the map in markers. */
function pointToLayer(feature: { properties?: Record<string, unknown> }, latlng: L.LatLng) {
  return L.circleMarker(latlng, { radius: 4, ...parcelStyle(feature) });
}

function FitToData({ data }: { data: GeoJsonFeatureCollection | null }) {
  const map = useMap();
  useMemo(() => {
    if (!data?.features?.length) return;
    const bounds = L.geoJSON(data as never).getBounds();
    if (bounds.isValid()) {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  }, [data, map]);
  return null;
}

export function FarmMapPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const { data, isLoading, error } = useParcelMap();
  // Nothing selects a plot yet — the popup carries the detail — but the
  // counts below need to survive a re-render, so derive them once.
  const [showZones] = useState(true);

  const counts = useMemo(() => {
    const acc = { total: 0, compliant: 0, needs_review: 0, non_compliant: 0, flagged: 0 };
    for (const f of data?.parcels?.features ?? []) {
      const p = f.properties as Record<string, unknown>;
      acc.total += 1;
      const s = String(p.eudrStatus ?? 'unknown');
      if (s in acc) acc[s as 'compliant'] += 1;
      if (p.deforestationRisk === 'high') acc.flagged += 1;
    }
    return acc;
  }, [data]);

  if (error) return <ErrorBanner message={error.message ?? String(error)} />;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl text-foreground">{t('farmMap.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('farmMap.subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <StatusTag tone="neutral">
          {intl.formatMessage({ id: 'farmMap.legend.total' }, { count: counts.total })}
        </StatusTag>
        <StatusTag tone="success">
          {intl.formatMessage({ id: 'farmMap.legend.compliant' }, { count: counts.compliant })}
        </StatusTag>
        <StatusTag tone="caution">
          {intl.formatMessage({ id: 'farmMap.legend.needsReview' }, { count: counts.needs_review })}
        </StatusTag>
        <StatusTag tone="danger">
          {intl.formatMessage(
            { id: 'farmMap.legend.nonCompliant' },
            { count: counts.non_compliant },
          )}
        </StatusTag>
        {counts.flagged > 0 && (
          <StatusTag tone="danger">
            <TriangleAlert className="size-3" />
            {intl.formatMessage({ id: 'farmMap.legend.flagged' }, { count: counts.flagged })}
          </StatusTag>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
        {isLoading && (
          <div className="absolute inset-0 z-[400] flex items-center justify-center bg-card/70">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <MapContainer
          // Ghana's cocoa belt — a sane frame before the data lands and
          // `FitToData` takes over.
          center={[6.7, -1.6]}
          zoom={8}
          scrollWheelZoom
          className="h-full w-full z-0"
        >
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Satellite">
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
            <LayersControl.Overlay checked={showZones} name={t('farmMap.layer.riskZones')}>
              <GeoJSON
                key={`zones-${data?.riskZones?.features?.length ?? 0}`}
                data={(data?.riskZones ?? { type: 'FeatureCollection', features: [] }) as never}
                style={riskZoneStyle}
                onEachFeature={(feature, layer) => {
                  const p = (feature.properties ?? {}) as Record<string, string>;
                  const kind =
                    p.riskType === 'protected_area'
                      ? t('farmMap.popup.protectedArea')
                      : t('farmMap.popup.deforestation');
                  layer.bindPopup(`<strong>${kind}</strong><br/>${p.name ?? ''}`);
                }}
              />
            </LayersControl.Overlay>
          </LayersControl>

          <GeoJSON
            key={`parcels-${data?.parcels?.features?.length ?? 0}`}
            data={(data?.parcels ?? { type: 'FeatureCollection', features: [] }) as never}
            style={parcelStyle}
            pointToLayer={pointToLayer as never}
            onEachFeature={(feature, layer) => {
              const p = (feature.properties ?? {}) as Record<string, string>;
              const flag =
                p.deforestationRisk === 'high'
                  ? `<br/><strong style="color:#dc2626">${t('farmMap.popup.flagged')}</strong>`
                  : '';
              layer.bindPopup(
                `<strong>${p.fieldId ?? ''}</strong><br/>${p.farmer ?? '—'}<br/>${
                  p.areaHa ?? '—'
                } ha · EUDR: ${p.eudrStatus ?? 'unknown'}${flag}`,
              );
            }}
          />
          <FitToData data={data?.parcels ?? null} />
        </MapContainer>
      </div>
    </div>
  );
}
