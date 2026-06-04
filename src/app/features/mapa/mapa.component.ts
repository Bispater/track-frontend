import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, effect, inject } from '@angular/core';
import * as L from 'leaflet';
import { VehicleStoreService } from '../../core/vehicle-store.service';
import { IconComponent } from '../../shared/icon.component';

// Leaflet busca sus imágenes de marcador en la raíz del sitio y da 404 al empaquetar.
// Las servimos desde /assets/leaflet (ver angular.json) y fijamos el icono por defecto.
const leafletDefaultIcon = L.icon({
  iconRetinaUrl: '/assets/leaflet/marker-icon-2x.png',
  iconUrl: '/assets/leaflet/marker-icon.png',
  shadowUrl: '/assets/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = leafletDefaultIcon;

@Component({
  selector: 'app-mapa',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="card">
      <div class="card-header">
        <app-icon name="map" [size]="16" class="text-text-dim" />
        <h2>Posiciones en tiempo real</h2>
        <span class="badge badge-muted ml-2">{{ countVisible }} vehículos en el mapa</span>
      </div>
      <div #mapEl style="height: 560px; width: 100%;"></div>
    </div>
  `,
})
export class MapaComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>;
  store = inject(VehicleStoreService);
  private map?: L.Map;
  private markers?: L.LayerGroup;
  countVisible = 0;

  constructor() {
    // El effect debe registrarse en contexto de injection (el constructor)
    effect(() => {
      this.store.lastPollAt(); // se suscribe al signal
      if (this.map) this.refresh(false);
    });
  }

  ngAfterViewInit() {
    this.map = L.map(this.mapEl.nativeElement).setView([-33.45, -70.66], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(this.map);
    this.markers = L.layerGroup().addTo(this.map);
    this.refresh(true);
  }
  ngOnDestroy() { this.map?.remove(); }

  refresh(fitBounds: boolean) {
    if (!this.map || !this.markers) return;
    this.markers.clearLayers();
    const bounds: L.LatLngTuple[] = [];
    for (const v of this.store.list()) {
      const p = v.position;
      if (!p || p.lat == null || p.lng == null) continue;
      const m = L.marker([p.lat, p.lng]).addTo(this.markers);
      m.bindPopup(
        `<b>${this.escape(v.name)}</b><br>` +
        `${this.escape(v.plate || '')}<br>` +
        `${(p.speed ?? 0)} km/h · ${p.ignition || '—'}<br>` +
        `<small>${p.ts || ''}</small>`
      );
      bounds.push([p.lat, p.lng]);
    }
    this.countVisible = bounds.length;
    if (fitBounds && bounds.length > 1) this.map.fitBounds(bounds, { padding: [40, 40] });
  }

  private escape(s: string) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)); }
}
