// ── User & Auth ──────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type Locale = 'en' | 'fr';

// ── API Response ─────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Farmer ───────────────────────────────────────────────────
export interface Farmer {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  cooperativeId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Farm / Parcel (GIS) ─────────────────────────────────────
export interface FarmParcel {
  id: string;
  farmerId: string;
  name: string;
  area?: number;
  geometry?: GeoJSON.MultiPolygon;
  createdAt: Date;
  updatedAt: Date;
}

// ── Cooperative ──────────────────────────────────────────────
export interface Cooperative {
  id: string;
  name: string;
  region?: string;
  country?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Inspection ───────────────────────────────────────────────
export interface Inspection {
  id: string;
  farmerId: string;
  parcelId?: string;
  inspectorId: string;
  date: Date;
  status: InspectionStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type InspectionStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

// ── Traceability ─────────────────────────────────────────────
export interface Shipment {
  id: string;
  cooperativeId: string;
  origin: string;
  destination: string;
  status: ShipmentStatus;
  weight: number;
  departureDate?: Date;
  arrivalDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ShipmentStatus = 'pending' | 'in_transit' | 'delivered' | 'cancelled';

// ── EUDR Compliance ──────────────────────────────────────────
export interface EudrRecord {
  id: string;
  farmerId: string;
  parcelId: string;
  complianceStatus: EudrStatus;
  deforestationFree: boolean;
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type EudrStatus = 'compliant' | 'non_compliant' | 'pending_review';

// ── Training ─────────────────────────────────────────────────
export interface TrainingSession {
  id: string;
  title: string;
  description?: string;
  trainerId: string;
  date: Date;
  location?: string;
  participantCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

// ── GeoJSON helpers ──────────────────────────────────────────
export namespace GeoJSON {
  export interface Position {
    0: number;
    1: number;
    2?: number;
  }

  export interface MultiPolygon {
    type: 'MultiPolygon';
    coordinates: number[][][][];
  }

  export interface Point {
    type: 'Point';
    coordinates: [number, number];
  }
}
