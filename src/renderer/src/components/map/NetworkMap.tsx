import { useEffect, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { LatLngBounds } from 'leaflet';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import type { MeshcoreContact } from '@shared/meshcore';
import { contactCoordinates, hasGpsFix } from '@shared/meshcore';

interface NetworkMapProps {
  contacts: MapContactEntry[];
}

interface MapContactEntry {
  contact: MeshcoreContact;
  stale: boolean;
}

interface LocatedContact extends MapContactEntry {
  contact: MeshcoreContact;
  position: [number, number];
  stale: boolean;
}

function markerRadius(zoom: number, stale: boolean): number {
  const baseRadius = stale ? 5 : 6;
  const scaledRadius = baseRadius + (zoom - 8) * 0.4;
  return Math.max(stale ? 3 : 4, Math.min(stale ? 7 : 8, scaledRadius));
}

function MapViewportSync({ contacts }: { contacts: LocatedContact[] }) {
  const map = useMap();
  const signature = contacts
    .map(({ contact, position }) => `${contact.shortHex}:${position[0]}:${position[1]}`)
    .join('|');

  useEffect(() => {
    if (contacts.length === 0) {
      map.setView([51.5072, -0.1276], 11);
      return;
    }

    if (contacts.length === 1) {
      map.setView(contacts[0].position, 13);
      return;
    }

    const bounds = new LatLngBounds(contacts.map((contact) => contact.position));

    map.fitBounds(bounds, {
      padding: [36, 36],
      maxZoom: 14
    });
  }, [contacts, map, signature]);

  return null;
}

function ZoomResponsiveMarker({ contact, position, stale }: LocatedContact) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());

  useEffect(() => {
    const handleZoom = () => {
      setZoom(map.getZoom());
    };

    map.on('zoomend', handleZoom);
    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map]);

  return (
    <CircleMarker
      center={position}
      radius={markerRadius(zoom, stale)}
      pathOptions={{
        color: stale ? '#cbd5e1' : '#93c5fd',
        fillColor: stale ? '#64748b' : '#2563eb',
        fillOpacity: stale ? 0.55 : 0.9,
        weight: stale ? 1.5 : 2
      }}
    >
      <Popup>
        <strong>{contact.displayName}</strong>
        <br />
        {contact.shortHex}
        <br />
        {stale ? 'Archived node' : 'Live node'}
      </Popup>
    </CircleMarker>
  );
}

export function NetworkMap({ contacts }: NetworkMapProps) {
  const fixedContacts = contacts
    .filter(({ contact }) => hasGpsFix(contact))
    .map(({ contact, stale }) => {
      const position = contactCoordinates(contact);
      return position ? { contact, position, stale } : null;
    })
    .filter((entry): entry is LocatedContact => entry !== null);
  const center =
    fixedContacts[0]
      ? fixedContacts[0].position
      : ([51.5072, -0.1276] as [number, number]);

  return (
    <div className="mesh-panel h-full overflow-hidden p-2">
      <MapContainer center={center} zoom={12} className="h-full w-full rounded-[1.4rem]">
        <TileLayer
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          subdomains="abcd"
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <MapViewportSync contacts={fixedContacts} />
        {fixedContacts.map(({ contact, position, stale }) => (
          <ZoomResponsiveMarker key={contact.shortHex} contact={contact} position={position} stale={stale} />
        ))}
      </MapContainer>
    </div>
  );
}
